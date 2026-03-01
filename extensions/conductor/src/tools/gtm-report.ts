import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { buildGtmReport, formatGtmReport } from "../lib/gtm-report.js";
import { notifyDiscord } from "../lib/notifier.js";

export function createGtmReportTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_gtm_report",
    description:
      "Generate a lightweight private GTM digest from local snapshots and experiment tracking.",
    parameters: Type.Object({
      company: Type.Optional(Type.String({ description: "Optional company key filter." })),
      notify: Type.Optional(
        Type.Boolean({
          description: "Also send the GTM report to the private notification target.",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const company = readStringParam(params, "company");
      const notify = params.notify === true;
      const result = await buildGtmReport({
        api,
        companyFilter: company ?? undefined,
      });
      const report = formatGtmReport(result.entries);

      if (notify) {
        await notifyDiscord(api, {
          audience: "private",
          text: report,
        }).catch(() => undefined);
      }

      return jsonResult({
        entries: result.entries,
        report,
        notified: notify,
      });
    },
  };
}
