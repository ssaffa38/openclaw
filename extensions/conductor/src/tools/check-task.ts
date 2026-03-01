import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { runMonitorPass } from "../lib/monitor.js";
import { getTask } from "../lib/registry.js";

export function createCheckTaskTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_check_task",
    description: "Get a single Conductor task and refresh monitor-derived state.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to inspect." }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = readStringParam(params, "taskId", { required: true });
      const cfg = resolveConductorConfig(api);
      await runMonitorPass(api, cfg.tasksPath);
      const task = await getTask(cfg.tasksPath, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      return jsonResult({ task });
    },
  };
}
