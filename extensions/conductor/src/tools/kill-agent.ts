import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { getTask, removeTask, upsertTask } from "../lib/registry.js";
import { killSession } from "../lib/tmux.js";
import { removeWorktree } from "../lib/worktree.js";

export function createKillAgentTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_kill_agent",
    description: "Stop a running Conductor task and optionally remove its worktree.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to stop." }),
      removeWorktree: Type.Optional(
        Type.Boolean({ description: "Remove the worktree and delete the task entry." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = readStringParam(params, "taskId", { required: true });
      const removeWorktreeRequested = params.removeWorktree === true;
      const cfg = resolveConductorConfig(api);
      const task = await getTask(cfg.tasksPath, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      await killSession(task.tmuxSession);

      if (removeWorktreeRequested) {
        await removeWorktree({ repoPath: task.repoPath, worktreePath: task.worktree });
        await removeTask(cfg.tasksPath, task.id);
        return jsonResult({ taskId: task.id, removed: true });
      }

      task.checks.tmuxAlive = false;
      task.status = "cancelled";
      await upsertTask(cfg.tasksPath, task);
      return jsonResult({ task });
    },
  };
}
