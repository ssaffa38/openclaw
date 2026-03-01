import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { readRegistry, removeTask, upsertTask } from "../lib/registry.js";
import { hasSession } from "../lib/tmux.js";
import { removeWorktree } from "../lib/worktree.js";

export function createCleanupTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_cleanup",
    description: "Remove completed or dead tasks and optionally prune their worktrees.",
    parameters: Type.Object({
      removeWorktrees: Type.Optional(
        Type.Boolean({ description: "Also remove associated worktrees." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const cfg = resolveConductorConfig(api);
      const registry = await readRegistry(cfg.tasksPath);
      const removeWorktrees = params.removeWorktrees !== false;
      const cleaned: string[] = [];
      const updated: string[] = [];

      for (const task of registry.tasks) {
        const tmuxAlive = await hasSession(task.tmuxSession);
        task.checks.tmuxAlive = tmuxAlive;

        if (!tmuxAlive && task.status === "running" && !task.pr.number) {
          task.status = "failed";
          await upsertTask(cfg.tasksPath, task);
          updated.push(task.id);
          continue;
        }

        if (["cancelled", "failed", "merged"].includes(task.status)) {
          if (removeWorktrees) {
            await removeWorktree({ repoPath: task.repoPath, worktreePath: task.worktree });
          }
          await removeTask(cfg.tasksPath, task.id);
          cleaned.push(task.id);
        }
      }

      return jsonResult({ cleaned, updated });
    },
  };
}
