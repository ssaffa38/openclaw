import { beforeEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.fn();

vi.mock("./shell.js", () => ({
  runCommand,
}));

describe("github helpers", () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  it("finds a pull request snapshot from gh output", async () => {
    runCommand.mockResolvedValueOnce({
      stdout: '{"number":42,"url":"https://github.com/sj/repo/pull/42","headRefOid":"abc123"}\n',
      stderr: "",
    });

    const { findPullRequest } = await import("./github.js");
    await expect(findPullRequest("sj/repo", "conductor/test")).resolves.toEqual({
      number: 42,
      url: "https://github.com/sj/repo/pull/42",
      lastCommitSha: "abc123",
    });
  });

  it("extracts structured reviews from review comments", async () => {
    runCommand.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          id: 7,
          body: 'Looks good\n<!-- CONDUCTOR_REVIEW: {"reviewer":"claude","verdict":"approve","critical":0,"warnings":1} -->',
          user: { login: "github-user" },
          created_at: "2026-02-28T12:00:00.000Z",
        },
        {
          id: 8,
          body: "No contract here",
          user: { login: "ignored" },
          created_at: "2026-02-28T12:01:00.000Z",
        },
      ]),
      stderr: "",
    });

    const { getStructuredReviews } = await import("./github.js");
    await expect(getStructuredReviews("sj/repo", 42)).resolves.toEqual([
      {
        reviewer: "claude",
        verdict: "approve",
        critical: 0,
        warnings: 1,
        commentId: 7,
        timestamp: Date.parse("2026-02-28T12:00:00.000Z"),
      },
    ]);
  });

  it("loads PR body and changed files metadata", async () => {
    runCommand
      .mockResolvedValueOnce({
        stdout: "## Summary\n![Screenshot](https://example.com/screen.png)\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: "src/app/page.tsx\nsrc/styles.css\n",
        stderr: "",
      });

    const { getPullRequestMetadata } = await import("./github.js");
    await expect(getPullRequestMetadata("sj/repo", 42)).resolves.toEqual({
      body: "## Summary\n![Screenshot](https://example.com/screen.png)",
      files: ["src/app/page.tsx", "src/styles.css"],
    });
  });
});
