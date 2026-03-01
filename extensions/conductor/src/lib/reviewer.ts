import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ConductorTask, ReviewResult } from "../types.js";
import { getPullRequestMetadata } from "./github.js";
import { runCommand } from "./shell.js";

const REVIEW_CONTRACT_RE = /<!--\s*CONDUCTOR_REVIEW:\s*(\{[\s\S]*?\})\s*-->/;

export type ReviewerSpec = {
  key: string;
  label: string;
  command: "claude" | "gemini";
  model: string;
};

const DEFAULT_REVIEWERS: Record<string, ReviewerSpec> = {
  claude: {
    key: "claude",
    label: "claude",
    command: "claude",
    model: "claude-haiku-4-5-20251001",
  },
  gemini: {
    key: "gemini",
    label: "gemini",
    command: "gemini",
    model: "gemini-3-flash-preview",
  },
};

function extractContract(
  text: string,
): Pick<ReviewResult, "reviewer" | "verdict" | "critical" | "warnings"> | null {
  const match = text.match(REVIEW_CONTRACT_RE);
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

function ensureContract(text: string, reviewer: string): string {
  if (REVIEW_CONTRACT_RE.test(text)) {
    return text.trim();
  }
  return `${text.trim()}\n\n<!-- CONDUCTOR_REVIEW: {"reviewer":"${reviewer}","verdict":"comment","critical":0,"warnings":1} -->`;
}

export function resolveReviewerSpec(reviewer: string): ReviewerSpec {
  const trimmed = reviewer.trim();
  if (!trimmed) {
    return DEFAULT_REVIEWERS.claude;
  }
  const [rawKey, rawModel] = trimmed.split(":", 2);
  const key = rawKey.trim().toLowerCase();
  const base = DEFAULT_REVIEWERS[key];
  if (!base) {
    throw new Error(`Unsupported reviewer: ${reviewer}`);
  }
  return {
    ...base,
    model: rawModel?.trim() ? rawModel.trim() : base.model,
  };
}

async function runReviewerCommand(params: {
  task: ConductorTask;
  spec: ReviewerSpec;
  prompt: string;
}): Promise<string> {
  const args =
    params.spec.command === "claude"
      ? ["--model", params.spec.model, "-p", params.prompt]
      : ["--model", params.spec.model, params.prompt];
  const reviewResult = await runCommand(params.spec.command, args, {
    cwd: params.task.worktree,
  });
  return reviewResult.stdout;
}

export async function runConfiguredReview(
  api: OpenClawPluginApi,
  task: ConductorTask,
  params?: {
    reviewer?: string;
    model?: string;
  },
): Promise<{
  body: string;
  parsed: Pick<ReviewResult, "reviewer" | "verdict" | "critical" | "warnings">;
}> {
  if (!task.pr.number) {
    throw new Error(`Task ${task.id} has no PR to review`);
  }

  const spec = resolveReviewerSpec(params?.reviewer ?? "claude");
  if (params?.model?.trim()) {
    spec.model = params.model.trim();
  }
  const diffResult = await runCommand("gh", [
    "pr",
    "diff",
    String(task.pr.number),
    "--repo",
    task.repoSlug,
  ]);
  const metadata = await getPullRequestMetadata(task.repoSlug, task.pr.number);

  const prompt = [
    "Review this pull request diff.",
    "Focus on logic errors, regressions, security issues, and missing edge cases.",
    "If there are UI file changes, check whether the PR body includes a screenshot.",
    "Return review text suitable for gh pr review --comment.",
    "End with exactly one machine-readable HTML comment in this format:",
    `<!-- CONDUCTOR_REVIEW: {"reviewer":"${spec.label}","verdict":"approve|request_changes|comment","critical":0,"warnings":0} -->`,
    "",
    "PR body:",
    metadata.body || "(empty)",
    "",
    "Changed files:",
    metadata.files.join("\n") || "(none)",
    "",
    "Diff:",
    diffResult.stdout,
  ].join("\n");

  const body = ensureContract(await runReviewerCommand({ task, spec, prompt }), spec.label);
  const parsed = extractContract(body);
  if (!parsed) {
    throw new Error("Claude review response did not include a valid CONDUCTOR_REVIEW contract");
  }

  return { body, parsed };
}

export async function runClaudeReview(
  api: OpenClawPluginApi,
  task: ConductorTask,
  params?: {
    model?: string;
  },
): Promise<{
  body: string;
  parsed: Pick<ReviewResult, "reviewer" | "verdict" | "critical" | "warnings">;
}> {
  return runConfiguredReview(api, task, { reviewer: "claude", model: params?.model });
}

export async function postReviewComment(task: ConductorTask, body: string): Promise<void> {
  if (!task.pr.number) {
    throw new Error(`Task ${task.id} has no PR to comment on`);
  }
  await runCommand("gh", [
    "pr",
    "review",
    String(task.pr.number),
    "--repo",
    task.repoSlug,
    "--comment",
    "--body",
    body,
  ]);
}
