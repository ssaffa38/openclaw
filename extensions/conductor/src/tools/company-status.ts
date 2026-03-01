import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { buildCompanyStatus, formatCompanyStatusReport } from "../lib/company-status.js";
import { notifyDiscord } from "../lib/notifier.js";

export function createCompanyStatusTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_company_status",
    description: "Show portfolio or single-company status across active tasks and discovered work.",
    parameters: Type.Object({
      company: Type.Optional(Type.String({ description: "Optional company key filter." })),
      notify: Type.Optional(
        Type.Boolean({ description: "Also post the status report to the War-room channel." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const company = readStringParam(params, "company");
      const notify = params.notify === true;
      const result = await buildCompanyStatus({
        api,
        companyFilter: company ?? undefined,
      });
      const report = formatCompanyStatusReport(result.entries);

      if (notify) {
        await notifyDiscord(api, {
          audience: "warRoom",
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
