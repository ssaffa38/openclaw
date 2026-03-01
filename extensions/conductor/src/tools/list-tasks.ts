import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { readRegistry } from "../lib/registry.js";

export function createListTasksTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_list_tasks",
    description: "List Conductor tasks from the local registry.",
    parameters: Type.Object({
      status: Type.Optional(Type.String({ description: "Optional status filter." })),
      company: Type.Optional(Type.String({ description: "Optional company filter." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const cfg = resolveConductorConfig(api);
      const registry = await readRegistry(cfg.tasksPath);
      const status = typeof params.status === "string" ? params.status.trim() : "";
      const company = typeof params.company === "string" ? params.company.trim() : "";
      const tasks = registry.tasks.filter((task) => {
        if (status && task.status !== status) {
          return false;
        }
        if (company && task.company !== company) {
          return false;
        }
        return true;
      });
      return jsonResult({ tasks });
    },
  };
}
