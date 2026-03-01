import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { getTask, upsertTask } from "../lib/registry.js";
import { captureSessionTail, sendMessageToSession } from "../lib/tmux.js";

export function createRedirectAgentTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_redirect_agent",
    description: "Send corrective guidance to a running Conductor tmux session.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to redirect." }),
      message: Type.String({ description: "Instruction to send into the running tmux session." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = readStringParam(params, "taskId", { required: true });
      const message = readStringParam(params, "message", { required: true });
      const cfg = resolveConductorConfig(api);
      const task = await getTask(cfg.tasksPath, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      await sendMessageToSession({ sessionName: task.tmuxSession, message });
      task.updatedAt = Date.now();
      task.redirects = (task.redirects ?? []).concat({
        message,
        timestamp: task.updatedAt,
      });
      await upsertTask(cfg.tasksPath, task);

      const tail = await captureSessionTail({ sessionName: task.tmuxSession, lines: 20 }).catch(
        () => "",
      );

      return jsonResult({
        taskId: task.id,
        session: task.tmuxSession,
        redirected: true,
        redirectCount: task.redirects.length,
        tail,
      });
    },
  };
}
