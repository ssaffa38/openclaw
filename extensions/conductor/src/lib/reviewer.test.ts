import { beforeEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.fn();
const getPullRequestMetadata = vi.fn();

vi.mock("./shell.js", () => ({
  runCommand,
}));

vi.mock("./github.js", () => ({
  getPullRequestMetadata,
}));

describe("reviewer helpers", () => {
  beforeEach(() => {
    runCommand.mockReset();
    getPullRequestMetadata.mockReset();
  });

  it("runs a Claude review and preserves the review contract", async () => {
    runCommand
      .mockResolvedValueOnce({ stdout: "diff --git a/file b/file\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout:
          'Looks good.\n\n<!-- CONDUCTOR_REVIEW: {"reviewer":"claude","verdict":"approve","critical":0,"warnings":1} -->',
        stderr: "",
      });
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary",
      files: ["src/server/api.ts"],
    });

    const { runClaudeReview } = await import("./reviewer.js");
    const result = await runClaudeReview(
      {} as never,
      {
        id: "task-1",
        repoSlug: "sj/repo",
        pr: { number: 42, url: null, lastCommitSha: null },
        worktree: "/tmp/repo",
      } as never,
    );

    expect(result.parsed).toEqual({
      reviewer: "claude",
      verdict: "approve",
      critical: 0,
      warnings: 1,
    });
    expect(result.body).toContain("CONDUCTOR_REVIEW");
  });

  it("adds a default contract when Claude returns plain text only", async () => {
    runCommand
      .mockResolvedValueOnce({ stdout: "diff --git a/file b/file\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "Needs more tests.", stderr: "" });
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary",
      files: ["src/server/api.ts"],
    });

    const { runClaudeReview } = await import("./reviewer.js");
    const result = await runClaudeReview(
      {} as never,
      {
        id: "task-1",
        repoSlug: "sj/repo",
        pr: { number: 42, url: null, lastCommitSha: null },
        worktree: "/tmp/repo",
      } as never,
    );

    expect(result.parsed.reviewer).toBe("claude");
    expect(result.parsed.verdict).toBe("comment");
    expect(result.body).toContain("CONDUCTOR_REVIEW");
  });

  it("runs Gemini reviews with the Gemini CLI prompt shape", async () => {
    runCommand
      .mockResolvedValueOnce({ stdout: "diff --git a/file b/file\n", stderr: "" })
      .mockResolvedValueOnce({
        stdout:
          'Looks fine.\n\n<!-- CONDUCTOR_REVIEW: {"reviewer":"gemini","verdict":"approve","critical":0,"warnings":0} -->',
        stderr: "",
      });
    getPullRequestMetadata.mockResolvedValue({
      body: "## Summary",
      files: ["src/server/api.ts"],
    });

    const { runConfiguredReview } = await import("./reviewer.js");
    const result = await runConfiguredReview(
      {} as never,
      {
        id: "task-1",
        repoSlug: "sj/repo",
        pr: { number: 42, url: null, lastCommitSha: null },
        worktree: "/tmp/repo",
      } as never,
      { reviewer: "gemini" },
    );

    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "gemini",
      ["--model", "gemini-3-flash-preview", expect.any(String)],
      { cwd: "/tmp/repo" },
    );
    expect(result.parsed.reviewer).toBe("gemini");
  });
});
