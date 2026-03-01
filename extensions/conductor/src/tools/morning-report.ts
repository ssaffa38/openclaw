import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult } from "../../../../src/agents/tools/common.js";
import { buildMorningReport } from "../lib/morning-report.js";
import { notifyDiscord } from "../lib/notifier.js";

export function createMorningReportTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_morning_report",
    description: "Generate the current morning report digest and optionally send it privately.",
    parameters: Type.Object({
      notify: Type.Optional(
        Type.Boolean({ description: "Also send the report to the private notification target." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const notify = params.notify === true;
      const report = await buildMorningReport(api);

      if (notify) {
        await notifyDiscord(api, {
          audience: "private",
          text: report.report,
        }).catch(() => undefined);
      }

      return jsonResult({
        entries: report.entries,
        report: report.report,
        notified: notify,
      });
    },
  };
}
