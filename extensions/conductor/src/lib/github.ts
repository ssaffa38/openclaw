import type { ReviewResult } from "../types.js";
import { runCommand } from "./shell.js";

export type PullRequestSnapshot = {
  number: number;
  url: string;
  lastCommitSha: string;
};

export type PullRequestMetadata = {
  body: string;
  files: string[];
};

export async function findPullRequest(
  repoSlug: string,
  branchName: string,
): Promise<PullRequestSnapshot | null> {
  const result = await runCommand("gh", [
    "pr",
    "list",
    "--repo",
    repoSlug,
    "--head",
    branchName,
    "--json",
    "number,url,headRefOid",
    "--jq",
    ".[]? | @json",
  ]);
  const line = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) {
    return null;
  }
  const parsed = JSON.parse(line) as { number: number; url: string; headRefOid: string };
  return {
    number: parsed.number,
    url: parsed.url,
    lastCommitSha: parsed.headRefOid,
  };
}

export async function getCiStatus(
  repoSlug: string,
  prNumber: number,
): Promise<"pending" | "passing" | "failing"> {
  const result = await runCommand("gh", [
    "pr",
    "view",
    String(prNumber),
    "--repo",
    repoSlug,
    "--json",
    "statusCheckRollup",
  ]);
  const parsed = JSON.parse(result.stdout) as {
    statusCheckRollup?: Array<{ conclusion?: string | null; status?: string | null }>;
  };
  const contexts = parsed.statusCheckRollup ?? [];
  if (contexts.length === 0) {
    return "pending";
  }
  if (
    contexts.some((ctx) => ctx.conclusion === "FAILURE" || ctx.conclusion === "STARTUP_FAILURE")
  ) {
    return "failing";
  }
  if (
    contexts.some(
      (ctx) => !ctx.conclusion || ctx.status === "IN_PROGRESS" || ctx.status === "QUEUED",
    )
  ) {
    return "pending";
  }
  return "passing";
}

export async function getPullRequestMetadata(
  repoSlug: string,
  prNumber: number,
): Promise<PullRequestMetadata> {
  const bodyResult = await runCommand("gh", [
    "pr",
    "view",
    String(prNumber),
    "--repo",
    repoSlug,
    "--json",
    "body",
    "--jq",
    ".body",
  ]);
  const filesResult = await runCommand("gh", [
    "pr",
    "diff",
    String(prNumber),
    "--repo",
    repoSlug,
    "--name-only",
  ]);

  return {
    body: bodyResult.stdout.trim(),
    files: filesResult.stdout
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}

function extractReviewContract(
  body: string,
): Pick<ReviewResult, "reviewer" | "verdict" | "critical" | "warnings"> | null {
  const match = body.match(/<!--\s*CONDUCTOR_REVIEW:\s*(\{[\s\S]*?\})\s*-->/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = JSON.parse(match[1]) as {
    reviewer?: string;
    verdict?: ReviewResult["verdict"];
    critical?: number;
    warnings?: number;
  };
  if (!parsed.verdict) {
    return null;
  }
  return {
    reviewer: parsed.reviewer?.trim() || "unknown",
    verdict: parsed.verdict,
    critical: typeof parsed.critical === "number" ? parsed.critical : 0,
    warnings: typeof parsed.warnings === "number" ? parsed.warnings : 0,
  };
}

export async function getStructuredReviews(
  repoSlug: string,
  prNumber: number,
): Promise<ReviewResult[]> {
  const result = await runCommand("gh", ["api", `repos/${repoSlug}/pulls/${prNumber}/comments`]);
  const parsed = JSON.parse(result.stdout) as Array<{
    id: number;
    body?: string;
    user?: { login?: string };
    created_at?: string;
  }>;
  return parsed
    .map((comment) => {
      const contract = extractReviewContract(comment.body ?? "");
      if (!contract) {
        return null;
      }
      return {
        reviewer: contract.reviewer || comment.user?.login || "unknown",
        verdict: contract.verdict,
        critical: contract.critical,
        warnings: contract.warnings,
        commentId: comment.id,
        timestamp: Date.parse(comment.created_at ?? "") || Date.now(),
      } satisfies ReviewResult;
    })
    .filter((entry): entry is ReviewResult => entry !== null)
    .toSorted((a, b) => a.timestamp - b.timestamp);
}
