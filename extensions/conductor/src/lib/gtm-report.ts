import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type {
  CompaniesFile,
  CompanyGtmSnapshot,
  ExperimentRecord,
  ExperimentsFile,
  GtmSnapshotFile,
} from "../types.js";
import { loadCompanies } from "./company-loader.js";
import { resolveConductorConfig } from "./config.js";

export type GtmEntry = {
  companyId: string;
  companyName: string;
  snapshot: CompanyGtmSnapshot | null;
  experiments: ExperimentRecord[];
};

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function loadExperiments(filePath: string): Promise<ExperimentsFile> {
  const file = await readJsonFile<ExperimentsFile>(filePath, { experiments: [] });
  return {
    experiments: Array.isArray(file.experiments) ? file.experiments : [],
  };
}

export async function writeExperiments(filePath: string, data: ExperimentsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function upsertExperiment(
  filePath: string,
  experiment: ExperimentRecord,
): Promise<ExperimentRecord> {
  const file = await loadExperiments(filePath);
  const experiments = file.experiments.filter((entry) => entry.id !== experiment.id);
  experiments.push(experiment);
  experiments.sort((a, b) => a.id.localeCompare(b.id));
  await writeExperiments(filePath, { experiments });
  return experiment;
}

export async function loadGtmSnapshot(filePath: string): Promise<GtmSnapshotFile> {
  const file = await readJsonFile<GtmSnapshotFile>(filePath, { companies: {} });
  return {
    companies: file.companies && typeof file.companies === "object" ? file.companies : {},
  };
}

function hasGtmData(entry: GtmEntry): boolean {
  return Boolean(
    entry.snapshot?.pipelineValue ||
    entry.snapshot?.activeDeals ||
    entry.snapshot?.staleDeals?.length ||
    entry.snapshot?.pendingReplies?.length ||
    entry.snapshot?.notes?.length ||
    entry.experiments.length,
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMetricValue(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  if (value > 0 && value < 1) {
    return `${Math.round(value * 100)}%`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatExperimentSummary(experiment: ExperimentRecord): string {
  const metric = experiment.metrics ? Object.entries(experiment.metrics)[0] : null;
  const metricSummary = metric
    ? (() => {
        const [name, values] = metric;
        if (typeof values?.baseline !== "number" || typeof values?.current !== "number") {
          return null;
        }
        return `${name}: ${formatMetricValue(values.baseline)} -> ${formatMetricValue(values.current)}`;
      })()
    : null;

  const parts = [`Experiment "${experiment.id}"`, experiment.status];
  if (metricSummary) {
    parts.push(metricSummary);
  }
  if (experiment.nextReview) {
    parts.push(`next review ${experiment.nextReview}`);
  }
  return parts.join(" | ");
}

export async function buildGtmReport(params: {
  api: OpenClawPluginApi;
  companyFilter?: string;
}): Promise<{ entries: GtmEntry[]; companies: CompaniesFile["companies"] }> {
  const cfg = resolveConductorConfig(params.api);
  const [companiesFile, experimentsFile, snapshotFile] = await Promise.all([
    loadCompanies(cfg.companiesPath),
    loadExperiments(cfg.experimentsPath),
    loadGtmSnapshot(cfg.gtmSnapshotPath),
  ]);

  const entries = Object.entries(companiesFile.companies)
    .filter(([companyId]) => !params.companyFilter || companyId === params.companyFilter)
    .map(([companyId, company]) => ({
      companyId,
      companyName: company.name,
      snapshot: snapshotFile.companies[companyId] ?? null,
      experiments: experimentsFile.experiments.filter(
        (experiment) => experiment.company === companyId,
      ),
    }))
    .filter((entry) => params.companyFilter || hasGtmData(entry));

  return { entries, companies: companiesFile.companies };
}

export function formatGtmReport(entries: GtmEntry[]): string {
  if (entries.length === 0) {
    return "No GTM status available.";
  }

  const lines = ["GTM Status", ""];

  for (const entry of entries) {
    lines.push(entry.companyName);

    if (entry.snapshot?.pipelineValue || entry.snapshot?.activeDeals) {
      const pipelineParts: string[] = [];
      if (typeof entry.snapshot?.pipelineValue === "number") {
        pipelineParts.push(`Pipeline ${formatCurrency(entry.snapshot.pipelineValue)}`);
      }
      if (typeof entry.snapshot?.activeDeals === "number") {
        pipelineParts.push(`${entry.snapshot.activeDeals} active deal(s)`);
      }
      lines.push(`- ${pipelineParts.join(" across ")}`);
    }

    const staleDeals = entry.snapshot?.staleDeals ?? [];
    if (staleDeals.length > 0) {
      lines.push(`- ${staleDeals.length} stale deal(s)`);
      for (const deal of staleDeals.slice(0, 3)) {
        lines.push(
          `  - ${deal.name}${deal.stage ? ` (${deal.stage})` : ""} stale for ${deal.daysStale} day(s)`,
        );
      }
    }

    const pendingReplies = entry.snapshot?.pendingReplies ?? [];
    if (pendingReplies.length > 0) {
      lines.push(`- ${pendingReplies.length} reply/follow-up item(s)`);
      for (const reply of pendingReplies.slice(0, 3)) {
        const parts = [reply.name];
        if (reply.source) {
          parts.push(reply.source);
        }
        if (reply.summary) {
          parts.push(reply.summary);
        }
        lines.push(`  - ${parts.join(" | ")}`);
      }
    }

    if (entry.experiments.length > 0) {
      lines.push(`- ${entry.experiments.length} experiment(s) tracked`);
      for (const experiment of entry.experiments.slice(0, 2)) {
        lines.push(`  - ${formatExperimentSummary(experiment)}`);
      }
    }

    const notes = entry.snapshot?.notes ?? [];
    for (const note of notes.slice(0, 2)) {
      lines.push(`- Note: ${note}`);
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}
