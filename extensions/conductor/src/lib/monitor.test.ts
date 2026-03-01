import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConductorTask } from "../types.js";

const resolveConductorConfig = vi.fn();
const readRegistry = vi.fn();
const upsertTask = vi.fn();
const hasSession = vi.fn();
const spawnClaudeSession = vi.fn();
const findPullRequest = vi.fn();
const getCiStatus = vi.fn();
const getStructuredReviews = vi.fn();
const getPullRequestMetadata = vi.fn();
const notifyDiscord = vi.fn();
const runConfiguredReview = vi.fn();
const postReviewComment = vi.fn();
const resolveReviewerSpec = vi.fn();
const refreshCtDelegationTask = vi.fn();

vi.mock("./config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("./registry.js", () => ({
  readRegistry,
  upsertTask,
}));

vi.mock("./tmux.js", () => ({
  hasSession,
  spawnClaudeSession,
}));

vi.mock("./github.js", () => ({
  findPullRequest,
  getCiStatus,
  getStructuredReviews,
  getPullRequestMetadata,
}));

vi.mock("./notifier.js", () => ({
  notifyDiscord,
}));

vi.mock("./reviewer.js", () => ({
  runConfiguredReview,
  postReviewComment,
  resolveReviewerSpec,
}));

vi.mock("./ct-followup.js", () => ({
  refreshCtDelegationTask,
}));

function makeTask(overrides: Partial<ConductorTask> = {}): ConductorTask {
  return {
    id: "demo-task",
    company: "demo",
    repoSlug: "sj/demo",
    repoPath: "/tmp/demo",
    baseBranch: "main",
    branchName: "conductor/demo-task",
    tmuxSession: "conductor-demo-task",
    worktree: "/tmp/worktree",
    modelTier: 2,
    model: "claude-sonnet-4-5-20250929",
    prompt: "Do the thing",
    startedAt: Date.now() - 10_000,
    updatedAt: Date.now() - 10_000,
    status: "running",
    retries: 0,
    pr: { number: null, url: null, lastCommitSha: null },
    checks: { tmuxAlive: true, prCreated: false, ciStatus: null, reviews: [] },
    ...overrides,
  };
}

describe("runMonitorPass", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    readRegistry.mockReset();
    upsertTask.mockReset();
    hasSession.mockReset();
    spawnClaudeSession.mockReset();
    findPullRequest.mockReset();
    getCiStatus.mockReset();
    getStructuredReviews.mockReset();
    getPullRequestMetadata.mockReset();
    notifyDiscord.mockReset();
    runConfiguredReview.mockReset();
    postReviewComment.mockReset();
    resolveReviewerSpec.mockReset();
    refreshCtDelegationTask.mockReset();

    resolveConductorConfig.mockReturnValue({
      tasksPath: "/tmp/tasks.json",
      maxRetries: 3,
      reviewers: ["claude", "gemini"],
    });
    resolveReviewerSpec.mockImplementation((reviewer: string) => ({ label: reviewer }));
    notifyDiscord.mockResolvedValue(true);
    refreshCtDelegationTask.mockResolvedValue(undefined);
  });

  it("keeps a dead tmux task running during the PR discovery grace window", async () => {
    const task = makeTask({ updatedAt: Date.now() - 20_000 });
    readRegistry.mockResolvedValue({ tasks: [task] });
    hasSession.mockResolvedValue(false);
    findPullRequest.mockResolvedValue(null);

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/tasks.json",
      expect.objectContaining({ status: "running" }),
    );
    expect(notifyDiscord).not.toHaveBeenCalled();
  });

  it("marks ready tasks and notifies once when CI and reviews pass", async () => {
    resolveConductorConfig.mockReturnValue({
      tasksPath: "/tmp/tasks.json",
      maxRetries: 3,
      reviewers: ["claude-haiku"],
    });
    const task = makeTask({ status: "pr_open" });
    readRegistry.mockResolvedValue({ tasks: [task] });
    hasSession.mockResolvedValue(false);
    findPullRequest.mockResolvedValue({
      number: 42,
      url: "https://github.com/sj/demo/pull/42",
      lastCommitSha: "abc123",
    });
    getCiStatus.mockResolvedValue("passing");
    getStructuredReviews.mockResolvedValue([
      {
        reviewer: "claude-haiku",
        verdict: "approve",
        critical: 0,
        warnings: 0,
        timestamp: Date.now(),
      },
    ]);
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary\nBackend only",
      files: ["src/server/api.ts"],
    });
    notifyDiscord.mockResolvedValue(true);

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/tasks.json",
      expect.objectContaining({
        status: "ready",
        pr: expect.objectContaining({ number: 42 }),
      }),
    );
    expect(notifyDiscord).toHaveBeenCalled();
  });

  it("auto-runs missing configured reviews once CI passes", async () => {
    const task = makeTask({ status: "pr_open" });
    readRegistry.mockResolvedValue({ tasks: [task] });
    hasSession.mockResolvedValue(false);
    findPullRequest.mockResolvedValue({
      number: 42,
      url: "https://github.com/sj/demo/pull/42",
      lastCommitSha: "abc123",
    });
    getCiStatus.mockResolvedValue("passing");
    getStructuredReviews.mockResolvedValue([]);
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary\nBackend only",
      files: ["src/server/api.ts"],
    });
    runConfiguredReview
      .mockResolvedValueOnce({
        body: 'Claude review\n\n<!-- CONDUCTOR_REVIEW: {"reviewer":"claude","verdict":"approve","critical":0,"warnings":0} -->',
        parsed: { reviewer: "claude", verdict: "approve", critical: 0, warnings: 0 },
      })
      .mockResolvedValueOnce({
        body: 'Gemini review\n\n<!-- CONDUCTOR_REVIEW: {"reviewer":"gemini","verdict":"approve","critical":0,"warnings":0} -->',
        parsed: { reviewer: "gemini", verdict: "approve", critical: 0, warnings: 0 },
      });
    postReviewComment.mockResolvedValue(undefined);

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(runConfiguredReview).toHaveBeenCalledTimes(2);
    expect(postReviewComment).toHaveBeenCalledTimes(2);
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/tasks.json",
      expect.objectContaining({
        status: "ready",
        checks: expect.objectContaining({
          reviews: expect.arrayContaining([
            expect.objectContaining({ reviewer: "claude", verdict: "approve" }),
            expect.objectContaining({ reviewer: "gemini", verdict: "approve" }),
          ]),
        }),
      }),
    );
  });

  it("keeps a UI PR in reviewing until a screenshot exists in the PR body", async () => {
    const task = makeTask({ status: "pr_open" });
    readRegistry.mockResolvedValue({ tasks: [task] });
    hasSession.mockResolvedValue(false);
    findPullRequest.mockResolvedValue({
      number: 42,
      url: "https://github.com/sj/demo/pull/42",
      lastCommitSha: "abc123",
    });
    getCiStatus.mockResolvedValue("passing");
    getStructuredReviews.mockResolvedValue([
      {
        reviewer: "claude-haiku",
        verdict: "approve",
        critical: 0,
        warnings: 0,
        timestamp: Date.now(),
      },
    ]);
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary\nNo screenshot yet",
      files: ["src/app/page.tsx"],
    });

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/tasks.json",
      expect.objectContaining({ status: "reviewing" }),
    );
  });

  it("does not send duplicate PR-created notifications across repeated monitor passes", async () => {
    const task = makeTask({
      lastNotifiedStatus: "pr_created",
      pr: {
        number: 42,
        url: "https://github.com/sj/demo/pull/42",
        lastCommitSha: "abc123",
      },
      checks: {
        tmuxAlive: false,
        prCreated: true,
        ciStatus: "pending",
        reviews: [],
      },
      status: "pr_open",
    });
    readRegistry.mockResolvedValue({ tasks: [task] });
    hasSession.mockResolvedValue(false);
    findPullRequest.mockResolvedValue({
      number: 42,
      url: "https://github.com/sj/demo/pull/42",
      lastCommitSha: "abc123",
    });
    getCiStatus.mockResolvedValue("pending");
    getStructuredReviews.mockResolvedValue([]);
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary",
      files: ["src/server/task.ts"],
    });

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(notifyDiscord).not.toHaveBeenCalled();
  });

  it("respawns a dead agent before marking it failed when retries remain", async () => {
    const task = makeTask({
      status: "running",
      retries: 1,
      updatedAt: Date.now() - 700_000,
    });
    readRegistry.mockResolvedValue({ tasks: [task] });
    hasSession.mockResolvedValue(false);
    findPullRequest.mockResolvedValue(null);
    spawnClaudeSession.mockResolvedValue(undefined);

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(spawnClaudeSession).toHaveBeenCalledWith({
      sessionName: "conductor-demo-task",
      cwd: "/tmp/worktree",
      model: "claude-sonnet-4-5-20250929",
      prompt: expect.stringContaining("Recovery attempt 2:"),
    });
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/tasks.json",
      expect.objectContaining({
        status: "running",
        retries: 2,
        checks: expect.objectContaining({ tmuxAlive: true }),
      }),
    );
  });

  it("refreshes CT delegated tasks through the CT follow-up path", async () => {
    const task = makeTask({
      executor: "ct",
      status: "queued",
      delegation: {
        kind: "workspace",
        channelTarget: "channel:123",
        message: "delegate",
        requestedAt: Date.now() - 10_000,
      },
    });
    readRegistry.mockResolvedValue({ tasks: [task] });

    const { runMonitorPass } = await import("./monitor.js");
    await runMonitorPass(fakeApi() as never, "/tmp/tasks.json");

    expect(refreshCtDelegationTask).toHaveBeenCalledWith(expect.anything(), task);
    expect(upsertTask).toHaveBeenCalledWith("/tmp/tasks.json", task);
    expect(hasSession).not.toHaveBeenCalled();
  });
});

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
