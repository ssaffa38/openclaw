import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { notifyDiscord } from "../lib/notifier.js";
import { discoverWork, formatWorkDiscoveryReport } from "../lib/scan-work.js";

export function createScanWorkTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_scan_work",
    description:
      "Scan configured repos for unassigned issues, stale PRs, and local dirty branches.",
    parameters: Type.Object({
      company: Type.Optional(Type.String({ description: "Optional company key filter." })),
      notify: Type.Optional(
        Type.Boolean({ description: "Also post the report to the War-room channel." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const company = readStringParam(params, "company");
      const notify = params.notify === true;
      const cfg = resolveConductorConfig(api);
      const result = await discoverWork({
        api,
        companiesPath: cfg.companiesPath,
        companyFilter: company ?? undefined,
      });
      const report = formatWorkDiscoveryReport(result.findings);

      if (notify) {
        await notifyDiscord(api, {
          audience: "warRoom",
          text: report,
        }).catch(() => undefined);
      }

      return jsonResult({
        findings: result.findings,
        report,
        notified: notify,
      });
    },
  };
}
