import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ConductorTask } from "../types.js";
import { resolveConductorConfig } from "./config.js";
import { refreshCtDelegationTask } from "./ct-followup.js";
import {
  getCiStatus,
  getPullRequestMetadata,
  getStructuredReviews,
  findPullRequest,
} from "./github.js";
import { notifyDiscord } from "./notifier.js";
import { readRegistry, upsertTask } from "./registry.js";
import { postReviewComment, resolveReviewerSpec, runConfiguredReview } from "./reviewer.js";
import { hasSession, spawnClaudeSession } from "./tmux.js";

const FAILED_WITHOUT_PR_GRACE_MS = 600_000;
const UI_FILE_PATTERN = /\.(tsx|jsx|css|html)$/i;
const SCREENSHOT_PATTERN = /!\[[^\]]*]\([^)]+\)|https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?/i;

function hasUiChanges(files: string[]): boolean {
  return files.some((file) => UI_FILE_PATTERN.test(file));
}

function hasScreenshot(body: string): boolean {
  return SCREENSHOT_PATTERN.test(body);
}

function computeStatus(
  task: ConductorTask,
  metadata: { body: string; files: string[] } | null,
  requiredReviewers: string[],
): ConductorTask["status"] {
  if (task.pr.number) {
    if (metadata && hasUiChanges(metadata.files) && !hasScreenshot(metadata.body)) {
      return "reviewing";
    }
    if (task.checks.ciStatus === "passing" && task.checks.reviews.length > 0) {
      const reviewerSet = new Set(task.checks.reviews.map((review) => review.reviewer));
      const hasAllRequiredReviews = requiredReviewers.every((reviewer) =>
        reviewerSet.has(reviewer),
      );
      const approved = task.checks.reviews.every(
        (review) => review.verdict === "approve" && review.critical === 0,
      );
      return approved && hasAllRequiredReviews ? "ready" : "reviewing";
    }
    return "pr_open";
  }

  if (task.checks.tmuxAlive) {
    return "running";
  }

  const lastActivityAt = task.updatedAt ?? task.startedAt;
  return Date.now() - lastActivityAt < FAILED_WITHOUT_PR_GRACE_MS ? "running" : "failed";
}

function buildRespawnPrompt(task: ConductorTask): string {
  return [
    task.prompt.trim(),
    "",
    `Recovery attempt ${task.retries + 1}:`,
    "- The previous tmux session exited before a PR was created.",
    "- Resume from the current worktree state instead of starting from scratch.",
    "- Inspect git status, recover your place, finish the task, and create the PR when done.",
  ].join("\n");
}

async function maybeRespawnTask(api: OpenClawPluginApi, task: ConductorTask): Promise<boolean> {
  const cfg = resolveConductorConfig(api);
  const lastActivityAt = task.updatedAt ?? task.startedAt;
  if (
    task.pr.number ||
    task.checks.tmuxAlive ||
    Date.now() - lastActivityAt < FAILED_WITHOUT_PR_GRACE_MS
  ) {
    return false;
  }
  if (task.retries >= cfg.maxRetries) {
    return false;
  }

  task.prompt = buildRespawnPrompt(task);
  task.retries += 1;
  task.updatedAt = Date.now();
  await spawnClaudeSession({
    sessionName: task.tmuxSession,
    cwd: task.worktree,
    model: task.model,
    prompt: task.prompt,
  });
  task.checks.tmuxAlive = true;
  task.status = "running";
  await notifyDiscord(api, {
    audience: "private",
    text: `Respawned ${task.id} after tmux exited before PR creation (attempt ${task.retries}).`,
  }).catch(() => undefined);
  return true;
}

async function maybeRunMissingReviews(api: OpenClawPluginApi, task: ConductorTask): Promise<void> {
  if (!task.pr.number || task.checks.ciStatus !== "passing") {
    return;
  }

  const cfg = resolveConductorConfig(api);
  const existingReviewers = new Set(task.checks.reviews.map((review) => review.reviewer));

  for (const configuredReviewer of cfg.reviewers) {
    let reviewerLabel = "";
    try {
      reviewerLabel = resolveReviewerSpec(configuredReviewer).label;
    } catch (error) {
      api.logger.warn(
        `Skipping unsupported Conductor reviewer ${configuredReviewer}: ${String(error)}`,
      );
      continue;
    }
    if (existingReviewers.has(reviewerLabel)) {
      continue;
    }

    try {
      const review = await runConfiguredReview(api, task, { reviewer: configuredReviewer });
      await postReviewComment(task, review.body);
      const timestamp = Date.now();
      task.checks.reviews = task.checks.reviews
        .concat({
          reviewer: review.parsed.reviewer,
          verdict: review.parsed.verdict,
          critical: review.parsed.critical,
          warnings: review.parsed.warnings,
          timestamp,
        })
        .toSorted((a, b) => a.timestamp - b.timestamp);
      existingReviewers.add(review.parsed.reviewer);
    } catch (error) {
      api.logger.warn(
        `Conductor review execution failed for ${task.id} reviewer ${configuredReviewer}: ${String(error)}`,
      );
      await notifyDiscord(api, {
        audience: "private",
        text: `Review execution failed for ${task.id} reviewer ${configuredReviewer}.`,
      }).catch(() => undefined);
    }
  }
}

async function notifyIfNeeded(
  api: OpenClawPluginApi,
  task: ConductorTask,
  previousStatus: string,
): Promise<void> {
  if (task.pr.number && task.lastNotifiedStatus !== "pr_created") {
    const sent = await notifyDiscord(api, {
      audience: "warRoom",
      text: `PR created for ${task.company}: #${task.pr.number} ${task.pr.url ?? ""}`.trim(),
    });
    if (sent) {
      task.lastNotifiedStatus = "pr_created";
    }
    return;
  }

  if (task.status !== previousStatus && ["failed", "ready"].includes(task.status)) {
    const sent = await notifyDiscord(api, {
      audience: task.status === "failed" ? "private" : "warRoom",
      text:
        task.status === "ready"
          ? `Task ${task.id} is ready. PR #${task.pr.number} has passing CI.`
          : `Task ${task.id} failed before PR creation.`,
    });
    if (sent) {
      task.lastNotifiedStatus = task.status;
    }
  }
}

export async function runMonitorPass(
  api: OpenClawPluginApi,
  tasksPath: string,
): Promise<{ checked: number }> {
  const registry = await readRegistry(tasksPath);
  const cfg = resolveConductorConfig(api);
  const requiredReviewers = cfg.reviewers
    .map((reviewer) => {
      try {
        return resolveReviewerSpec(reviewer).label;
      } catch (error) {
        api.logger.warn(`Ignoring unsupported Conductor reviewer ${reviewer}: ${String(error)}`);
        return null;
      }
    })
    .filter((reviewer): reviewer is string => Boolean(reviewer));

  for (const task of registry.tasks) {
    if (task.executor === "ct") {
      await refreshCtDelegationTask(api, task);
      await upsertTask(tasksPath, task);
      continue;
    }
    const previousStatus = task.status;
    task.checks.tmuxAlive = await hasSession(task.tmuxSession);
    let metadata: { body: string; files: string[] } | null = null;

    const pr = await findPullRequest(task.repoSlug, task.branchName);
    if (pr) {
      task.pr.number = pr.number;
      task.pr.url = pr.url;
      task.pr.lastCommitSha = pr.lastCommitSha;
      task.checks.prCreated = true;
      task.checks.ciStatus = await getCiStatus(task.repoSlug, pr.number);
      task.checks.reviews = await getStructuredReviews(task.repoSlug, pr.number);
      metadata = await getPullRequestMetadata(task.repoSlug, pr.number);
      await maybeRunMissingReviews(api, task);
    } else {
      await maybeRespawnTask(api, task);
    }

    task.status = computeStatus(task, metadata, requiredReviewers);
    task.updatedAt = Date.now();
    await notifyIfNeeded(api, task, previousStatus);
    await upsertTask(tasksPath, task);
  }
  return { checked: registry.tasks.length };
}
