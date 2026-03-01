import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { notifyDiscord } from "../lib/notifier.js";
import { getTask, removeTask, upsertTask } from "../lib/registry.js";
import { runCommand } from "../lib/shell.js";
import { killSession } from "../lib/tmux.js";
import { removeWorktree } from "../lib/worktree.js";

export function createMergePrTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_merge_pr",
    description: "Merge a ready Conductor PR after explicit confirmation.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID whose PR should be merged." }),
      confirm: Type.Boolean({ description: "Must be true to actually merge the PR." }),
      method: Type.Optional(
        Type.Union([Type.Literal("merge"), Type.Literal("squash"), Type.Literal("rebase")], {
          description: "GitHub merge method. Defaults to squash.",
        }),
      ),
      cleanup: Type.Optional(
        Type.Boolean({ description: "Also remove the worktree and task entry after merge." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = readStringParam(params, "taskId", { required: true });
      const confirm = params.confirm === true;
      const method =
        params.method === "merge" || params.method === "rebase" || params.method === "squash"
          ? params.method
          : "squash";
      const cleanup = params.cleanup === true;
      const cfg = resolveConductorConfig(api);
      const task = await getTask(cfg.tasksPath, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (!confirm) {
        throw new Error(`Merge confirmation required for ${task.id}. Re-run with confirm: true.`);
      }
      if (!task.pr.number) {
        throw new Error(`Task ${task.id} does not have a PR to merge`);
      }
      if (task.status !== "ready") {
        throw new Error(`Task ${task.id} is not ready to merge (current status: ${task.status})`);
      }

      await runCommand("gh", [
        "pr",
        "merge",
        String(task.pr.number),
        "--repo",
        task.repoSlug,
        `--${method}`,
        "--delete-branch",
      ]);

      await killSession(task.tmuxSession).catch(() => undefined);

      if (cleanup) {
        await removeWorktree({ repoPath: task.repoPath, worktreePath: task.worktree }).catch(
          () => undefined,
        );
        await removeTask(cfg.tasksPath, task.id);
      } else {
        task.status = "merged";
        task.updatedAt = Date.now();
        task.checks.tmuxAlive = false;
        await upsertTask(cfg.tasksPath, task);
      }

      await notifyDiscord(api, {
        audience: "warRoom",
        text: `Merged ${task.id}: PR #${task.pr.number} via ${method}.`,
      }).catch(() => undefined);

      return jsonResult({
        taskId: task.id,
        prNumber: task.pr.number,
        merged: true,
        method,
        cleanedUp: cleanup,
      });
    },
  };
}
