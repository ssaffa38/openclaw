import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ExperimentMetric, ExperimentRecord } from "../types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { loadCompanies } from "../lib/company-loader.js";
import { resolveConductorConfig } from "../lib/config.js";
import { loadExperiments, upsertExperiment } from "../lib/gtm-report.js";

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseMetrics(value: unknown): Record<string, ExperimentMetric> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, ExperimentMetric> = {};
  for (const [key, rawMetric] of Object.entries(value)) {
    if (!rawMetric || typeof rawMetric !== "object" || Array.isArray(rawMetric)) {
      continue;
    }
    const metric = rawMetric as Record<string, unknown>;
    const baseline = readOptionalNumber(metric.baseline);
    const current = readOptionalNumber(metric.current);
    const unit =
      typeof metric.unit === "string" && metric.unit.trim() ? metric.unit.trim() : undefined;
    if (baseline === undefined && current === undefined && !unit) {
      continue;
    }
    result[key] = { baseline, current, unit };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function createUpdateExperimentTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_update_experiment",
    description: "Create or update a lightweight GTM experiment record in experiments.json.",
    parameters: Type.Object({
      id: Type.String({ description: "Stable experiment id, eg exp-revive-pricing-v2." }),
      company: Type.String({ description: "Company key, eg revive-ai or ctvs." }),
      hypothesis: Type.Optional(Type.String({ description: "Experiment hypothesis." })),
      status: Type.Optional(
        Type.Union([
          Type.Literal("planned"),
          Type.Literal("running"),
          Type.Literal("holding"),
          Type.Literal("completed"),
          Type.Literal("cancelled"),
        ]),
      ),
      startDate: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD start date." })),
      nextReview: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD review date." })),
      notes: Type.Optional(Type.String({ description: "Optional experiment note." })),
      metrics: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const id = readStringParam(params, "id", { required: true });
      const company = readStringParam(params, "company", { required: true });
      const hypothesis = readStringParam(params, "hypothesis");
      const startDate = readStringParam(params, "startDate");
      const nextReview = readStringParam(params, "nextReview");
      const notes = readStringParam(params, "notes");
      const status =
        typeof params.status === "string" &&
        ["planned", "running", "holding", "completed", "cancelled"].includes(params.status)
          ? (params.status as ExperimentRecord["status"])
          : undefined;
      const metrics = parseMetrics(params.metrics);

      const cfg = resolveConductorConfig(api);
      const companies = await loadCompanies(cfg.companiesPath);
      if (!companies.companies[company]) {
        throw new Error(`Unknown company: ${company}`);
      }

      const file = await loadExperiments(cfg.experimentsPath);
      const existing = file.experiments.find((entry) => entry.id === id);
      if (!existing && !hypothesis) {
        throw new Error(`New experiment ${id} requires a hypothesis`);
      }

      const experiment: ExperimentRecord = {
        id,
        company,
        hypothesis: hypothesis ?? existing?.hypothesis ?? "",
        status: status ?? existing?.status ?? "planned",
        startDate: startDate ?? existing?.startDate,
        nextReview: nextReview ?? existing?.nextReview,
        notes: notes ?? existing?.notes,
        metrics: metrics ?? existing?.metrics,
      };

      await upsertExperiment(cfg.experimentsPath, experiment);

      return jsonResult({
        experiment,
        created: !existing,
        updated: Boolean(existing),
      });
    },
  };
}
