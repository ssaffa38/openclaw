import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { CompaniesFile, ConductorTask } from "../types.js";
import { loadCompanies } from "./company-loader.js";
import { resolveConductorConfig } from "./config.js";
import { readRegistry } from "./registry.js";
import { discoverWork, type WorkFinding } from "./scan-work.js";

type CompanyStatusEntry = {
  companyId: string;
  companyName: string;
  activeTasks: ConductorTask[];
  readyTasks: ConductorTask[];
  findings: WorkFinding[];
};

function isActiveTask(task: ConductorTask): boolean {
  return !["merged", "failed", "cancelled"].includes(task.status);
}

function summarizeFindings(findings: WorkFinding[]) {
  return {
    stalePrs: findings.filter((finding) => finding.kind === "stale_pr"),
    issues: findings.filter((finding) => finding.kind === "issue"),
    vercelErrors: findings.filter((finding) => finding.kind === "vercel_error"),
    dirtyRepos: findings.filter((finding) => finding.kind === "dirty_repo"),
    errors: findings.filter((finding) => finding.kind === "error"),
  };
}

function formatTaskLine(task: ConductorTask): string {
  if (task.pr?.number) {
    return `- ${task.id}: ${task.status} (PR #${task.pr.number})`;
  }
  return `- ${task.id}: ${task.status}`;
}

export async function buildCompanyStatus(params: {
  api: OpenClawPluginApi;
  companyFilter?: string;
}): Promise<{ entries: CompanyStatusEntry[]; companies: CompaniesFile["companies"] }> {
  const cfg = resolveConductorConfig(params.api);
  const [companiesFile, registry, work] = await Promise.all([
    loadCompanies(cfg.companiesPath),
    readRegistry(cfg.tasksPath),
    discoverWork({
      api: params.api,
      companiesPath: cfg.companiesPath,
      companyFilter: params.companyFilter,
    }),
  ]);

  const entries = Object.entries(companiesFile.companies)
    .filter(([companyId]) => !params.companyFilter || companyId === params.companyFilter)
    .map(([companyId, company]) => {
      const tasks = registry.tasks.filter((task) => task.company === companyId);
      return {
        companyId,
        companyName: company.name,
        activeTasks: tasks.filter(isActiveTask),
        readyTasks: tasks.filter((task) => task.status === "ready"),
        findings: work.findings.filter((finding) => finding.companyId === companyId),
      } satisfies CompanyStatusEntry;
    });

  return { entries, companies: companiesFile.companies };
}

export function formatCompanyStatusReport(entries: CompanyStatusEntry[]): string {
  if (entries.length === 0) {
    return "No company status available.";
  }

  const lines = ["Portfolio Status", ""];

  for (const entry of entries) {
    const findingSummary = summarizeFindings(entry.findings);
    lines.push(entry.companyName);

    if (entry.activeTasks.length === 0) {
      lines.push("- No active tasks");
    } else {
      lines.push(`- ${entry.activeTasks.length} active task(s)`);
      for (const task of entry.activeTasks.slice(0, 3)) {
        lines.push(`  ${formatTaskLine(task)}`);
      }
    }

    if (entry.readyTasks.length > 0) {
      lines.push(`- ${entry.readyTasks.length} ready PR task(s)`);
    }
    if (findingSummary.stalePrs.length > 0) {
      lines.push(`- ${findingSummary.stalePrs.length} stale PR(s)`);
    }
    if (findingSummary.issues.length > 0) {
      lines.push(`- ${findingSummary.issues.length} unassigned issue(s)`);
    }
    if (findingSummary.vercelErrors.length > 0) {
      lines.push(`- ${findingSummary.vercelErrors.length} Vercel error finding(s)`);
    }
    if (findingSummary.dirtyRepos.length > 0) {
      lines.push(`- ${findingSummary.dirtyRepos.length} dirty repo(s)`);
    }
    if (findingSummary.errors.length > 0) {
      lines.push(`- ${findingSummary.errors.length} scan error(s)`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
