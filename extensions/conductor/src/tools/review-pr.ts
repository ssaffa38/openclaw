import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { getTask, upsertTask } from "../lib/registry.js";
import { postReviewComment, runConfiguredReview } from "../lib/reviewer.js";

export function createReviewPrTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_review_pr",
    description: "Run a manual Claude review for a Conductor task PR and post it to GitHub.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID whose PR should be reviewed." }),
      reviewer: Type.Optional(
        Type.String({ description: "Reviewer key from config, eg claude or gemini." }),
      ),
      model: Type.Optional(Type.String({ description: "Optional Claude model override." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = readStringParam(params, "taskId", { required: true });
      const reviewer = readStringParam(params, "reviewer");
      const model = readStringParam(params, "model");
      const cfg = resolveConductorConfig(api);
      const task = await getTask(cfg.tasksPath, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (!task.pr.number) {
        throw new Error(`Task ${task.id} does not have a PR yet`);
      }

      const review = await runConfiguredReview(api, task, {
        reviewer: reviewer ?? cfg.reviewers[0] ?? "claude",
        model: model ?? undefined,
      });
      await postReviewComment(task, review.body);

      task.status = "reviewing";
      task.updatedAt = Date.now();
      task.checks.reviews = task.checks.reviews
        .concat({
          reviewer: review.parsed.reviewer,
          verdict: review.parsed.verdict,
          critical: review.parsed.critical,
          warnings: review.parsed.warnings,
          timestamp: task.updatedAt,
        })
        .toSorted((a, b) => a.timestamp - b.timestamp);
      await upsertTask(cfg.tasksPath, task);

      return jsonResult({
        taskId: task.id,
        prNumber: task.pr.number,
        review: review.parsed,
        posted: true,
      });
    },
  };
}
