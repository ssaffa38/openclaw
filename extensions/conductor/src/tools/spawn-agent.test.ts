import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCompanies = vi.fn();
const resolveCompanyRepo = vi.fn();
const resolveConductorConfig = vi.fn();
const readRegistry = vi.fn();
const upsertTask = vi.fn();
const notifyDiscord = vi.fn();
const buildPrompt = vi.fn();
const prepareWorktree = vi.fn();
const removeWorktree = vi.fn();
const spawnClaudeSession = vi.fn();
const killSession = vi.fn();

vi.mock("../lib/company-loader.js", () => ({
  loadCompanies,
  resolveCompanyRepo,
}));

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/registry.js", () => ({
  readRegistry,
  upsertTask,
}));

vi.mock("../lib/notifier.js", () => ({
  notifyDiscord,
}));

vi.mock("../lib/prompt-builder.js", () => ({
  buildPrompt,
}));

vi.mock("../lib/worktree.js", () => ({
  prepareWorktree,
  removeWorktree,
}));

vi.mock("../lib/tmux.js", () => ({
  spawnClaudeSession,
  killSession,
}));

function fakeApi() {
  return {
    id: "conductor",
    name: "conductor",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    resolvePath(input: string) {
      return input;
    },
  };
}

describe("conductor_spawn_agent", () => {
  beforeEach(() => {
    loadCompanies.mockReset();
    resolveCompanyRepo.mockReset();
    resolveConductorConfig.mockReset();
    readRegistry.mockReset();
    upsertTask.mockReset();
    notifyDiscord.mockReset();
    buildPrompt.mockReset();
    prepareWorktree.mockReset();
    removeWorktree.mockReset();
    spawnClaudeSession.mockReset();
    killSession.mockReset();

    resolveConductorConfig.mockReturnValue({
      companiesPath: "/tmp/companies.json",
      tasksPath: "/tmp/active-tasks.json",
      worktreeRoot: "/tmp/worktrees",
      maxConcurrentAgents: 3,
      maxRetries: 3,
      defaultModel: "claude-sonnet-4-5-20250929",
      reviewers: ["claude", "gemini"],
      monitorIntervalMs: 600_000,
      notifyChannels: {},
    });
    readRegistry.mockResolvedValue({ tasks: [] });
    loadCompanies.mockResolvedValue({
      companies: {
        demo: {
          name: "Demo Co",
          type: "test",
          repos: [{ path: "/tmp/repo", role: "web", pm: "npm", context: "demo-web" }],
        },
      },
    });
    resolveCompanyRepo.mockReturnValue({
      company: {
        name: "Demo Co",
        type: "test",
        keywords: ["demo"],
        repos: [{ path: "/tmp/repo", role: "web", pm: "npm", context: "demo-web" }],
      },
      repo: {
        path: "/tmp/repo",
        role: "web",
        pm: "npm",
        context: "demo-web",
      },
    });
    prepareWorktree.mockResolvedValue({
      repoSlug: "sj/demo",
      baseBranch: "main",
      worktreePath: "/tmp/worktrees/demo-task",
    });
    buildPrompt.mockResolvedValue("prompt");
    spawnClaudeSession.mockResolvedValue(undefined);
    killSession.mockResolvedValue(undefined);
    removeWorktree.mockResolvedValue(undefined);
    upsertTask.mockResolvedValue(undefined);
    notifyDiscord.mockResolvedValue(true);
  });

  it("spawns an agent and persists the canonical task", async () => {
    const { createSpawnAgentTool } = await import("./spawn-agent.js");
    const tool = createSpawnAgentTool(fakeApi() as never);

    const result = await tool.execute("id", {
      company: "demo",
      task: "Ship the homepage hero",
      taskId: "demo-task",
    });

    expect(prepareWorktree).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      repoSlug: undefined,
      branchName: "conductor/ship-the-homepage-hero",
      taskId: "demo-task",
      worktreeRoot: "/tmp/worktrees",
      pm: "npm",
    });
    expect(spawnClaudeSession).toHaveBeenCalledWith({
      sessionName: "conductor-demo-task",
      cwd: "/tmp/worktrees/demo-task",
      model: "claude-sonnet-4-5-20250929",
      prompt: "prompt",
    });
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/active-tasks.json",
      expect.objectContaining({
        id: "demo-task",
        company: "demo",
        repoSlug: "sj/demo",
        baseBranch: "main",
        branchName: "conductor/ship-the-homepage-hero",
        tmuxSession: "conductor-demo-task",
        worktree: "/tmp/worktrees/demo-task",
        prompt: "prompt",
      }),
    );
    expect(notifyDiscord).toHaveBeenCalled();
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.task.id).toBe("demo-task");
  });

  it("cleans up the tmux session and worktree if spawn fails after task creation", async () => {
    spawnClaudeSession.mockResolvedValue(undefined);
    upsertTask.mockRejectedValueOnce(new Error("write failed"));

    const { createSpawnAgentTool } = await import("./spawn-agent.js");
    const tool = createSpawnAgentTool(fakeApi() as never);

    await expect(
      tool.execute("id", {
        company: "demo",
        task: "Ship the homepage hero",
        taskId: "demo-task",
      }),
    ).rejects.toThrow(/write failed/);

    expect(killSession).toHaveBeenCalledWith("conductor-demo-task");
    expect(removeWorktree).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      worktreePath: "/tmp/worktrees/demo-task",
    });
  });

  it("auto-routes heavy tasks to tier 1", async () => {
    const { createSpawnAgentTool } = await import("./spawn-agent.js");
    const tool = createSpawnAgentTool(fakeApi() as never);

    await tool.execute("id", {
      company: "demo",
      task: "Refactor the entire booking system across multiple files and services",
      taskId: "demo-heavy-task",
    });

    expect(spawnClaudeSession).toHaveBeenCalledWith({
      sessionName: "conductor-demo-heavy-task",
      cwd: "/tmp/worktrees/demo-task",
      model: "claude-opus-4-5",
      prompt: "prompt",
    });
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/active-tasks.json",
      expect.objectContaining({
        id: "demo-heavy-task",
        modelTier: 1,
        model: "claude-opus-4-5",
      }),
    );
  });
});
