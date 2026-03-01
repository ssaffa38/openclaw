import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const getTask = vi.fn();
const upsertTask = vi.fn();
const removeTask = vi.fn();
const runCommand = vi.fn();
const killSession = vi.fn();
const removeWorktree = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/registry.js", () => ({
  getTask,
  upsertTask,
  removeTask,
}));

vi.mock("../lib/shell.js", () => ({
  runCommand,
}));

vi.mock("../lib/tmux.js", () => ({
  killSession,
}));

vi.mock("../lib/worktree.js", () => ({
  removeWorktree,
}));

vi.mock("../lib/notifier.js", () => ({
  notifyDiscord,
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

describe("conductor_merge_pr", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    getTask.mockReset();
    upsertTask.mockReset();
    removeTask.mockReset();
    runCommand.mockReset();
    killSession.mockReset();
    removeWorktree.mockReset();
    notifyDiscord.mockReset();

    resolveConductorConfig.mockReturnValue({ tasksPath: "/tmp/active-tasks.json" });
    getTask.mockResolvedValue({
      id: "task-1",
      repoSlug: "sj/repo",
      repoPath: "/tmp/repo",
      worktree: "/tmp/worktrees/task-1",
      tmuxSession: "conductor-task-1",
      status: "ready",
      updatedAt: 1,
      pr: { number: 42, url: "https://github.com/sj/repo/pull/42", lastCommitSha: "abc" },
      checks: { tmuxAlive: false },
    });
    runCommand.mockResolvedValue({ stdout: "", stderr: "" });
    killSession.mockResolvedValue(undefined);
    removeTask.mockResolvedValue(undefined);
    upsertTask.mockResolvedValue(undefined);
    removeWorktree.mockResolvedValue(undefined);
    notifyDiscord.mockResolvedValue(true);
  });

  it("merges a ready PR only after confirmation", async () => {
    const { createMergePrTool } = await import("./merge-pr.js");
    const tool = createMergePrTool(fakeApi() as never);

    const result = await tool.execute("id", { taskId: "task-1", confirm: true });

    expect(runCommand).toHaveBeenCalledWith("gh", [
      "pr",
      "merge",
      "42",
      "--repo",
      "sj/repo",
      "--squash",
      "--delete-branch",
    ]);
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/active-tasks.json",
      expect.objectContaining({
        status: "merged",
        checks: expect.objectContaining({ tmuxAlive: false }),
      }),
    );
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.merged).toBe(true);
  });

  it("rejects merge attempts without confirmation", async () => {
    const { createMergePrTool } = await import("./merge-pr.js");
    const tool = createMergePrTool(fakeApi() as never);

    await expect(tool.execute("id", { taskId: "task-1", confirm: false })).rejects.toThrow(
      /confirmation required/i,
    );

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("rejects merge attempts when the task is not ready", async () => {
    getTask.mockResolvedValueOnce({
      id: "task-1",
      status: "reviewing",
      pr: { number: 42 },
    });

    const { createMergePrTool } = await import("./merge-pr.js");
    const tool = createMergePrTool(fakeApi() as never);

    await expect(tool.execute("id", { taskId: "task-1", confirm: true })).rejects.toThrow(
      /not ready to merge/i,
    );
  });
});
