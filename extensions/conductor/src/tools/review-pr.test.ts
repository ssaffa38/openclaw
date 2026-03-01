import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const getTask = vi.fn();
const upsertTask = vi.fn();
const runConfiguredReview = vi.fn();
const postReviewComment = vi.fn();

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/registry.js", () => ({
  getTask,
  upsertTask,
}));

vi.mock("../lib/reviewer.js", () => ({
  runConfiguredReview,
  postReviewComment,
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

describe("conductor_review_pr", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    getTask.mockReset();
    upsertTask.mockReset();
    runConfiguredReview.mockReset();
    postReviewComment.mockReset();

    resolveConductorConfig.mockReturnValue({
      tasksPath: "/tmp/active-tasks.json",
      reviewers: ["claude", "gemini"],
    });
    getTask.mockResolvedValue({
      id: "task-1",
      status: "pr_open",
      updatedAt: 1,
      repoSlug: "sj/repo",
      pr: { number: 42, url: "https://github.com/sj/repo/pull/42", lastCommitSha: "abc" },
      checks: { reviews: [] },
    });
    runConfiguredReview.mockResolvedValue({
      body: 'Looks good.\n\n<!-- CONDUCTOR_REVIEW: {"reviewer":"claude","verdict":"approve","critical":0,"warnings":0} -->',
      parsed: { reviewer: "claude", verdict: "approve", critical: 0, warnings: 0 },
    });
    postReviewComment.mockResolvedValue(undefined);
    upsertTask.mockResolvedValue(undefined);
  });

  it("runs and posts a manual PR review", async () => {
    const { createReviewPrTool } = await import("./review-pr.js");
    const tool = createReviewPrTool(fakeApi() as never);

    const result = await tool.execute("id", { taskId: "task-1" });

    expect(runConfiguredReview).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      reviewer: "claude",
      model: undefined,
    });
    expect(postReviewComment).toHaveBeenCalled();
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/active-tasks.json",
      expect.objectContaining({
        status: "reviewing",
      }),
    );
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.posted).toBe(true);
  });
});
