import path from "node:path";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { CompaniesFile, CompanyEntry, CompanyRepo } from "../types.js";
import { loadCompanies } from "./company-loader.js";
import { resolveConductorConfig } from "./config.js";
import { expandHome } from "./paths.js";
import { runCommand } from "./shell.js";

const STALE_PR_DAYS = 5;

export type WorkFinding =
  | {
      kind: "issue";
      companyId: string;
      companyName: string;
      repoRole: string;
      repoPath: string;
      repoSlug: string;
      title: string;
      url: string;
      number: number;
      updatedAt: string;
      summary: string;
    }
  | {
      kind: "stale_pr";
      companyId: string;
      companyName: string;
      repoRole: string;
      repoPath: string;
      repoSlug: string;
      title: string;
      url: string;
      number: number;
      updatedAt: string;
      summary: string;
    }
  | {
      kind: "dirty_repo";
      companyId: string;
      companyName: string;
      repoRole: string;
      repoPath: string;
      repoSlug?: string;
      branchName: string;
      dirtyFiles: number;
      summary: string;
    }
  | {
      kind: "vercel_error";
      companyId: string;
      companyName: string;
      repoRole: string;
      repoPath: string;
      repoSlug?: string;
      project: string;
      deploymentUrl?: string;
      state?: string;
      summary: string;
    }
  | {
      kind: "error";
      companyId: string;
      companyName: string;
      repoRole: string;
      repoPath: string;
      summary: string;
    };

function daysOld(isoDate: string): number {
  return (Date.now() - Date.parse(isoDate)) / (24 * 60 * 60 * 1000);
}

async function resolveRepoSlug(repoPath: string): Promise<string> {
  const result = await runCommand(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd: repoPath },
  );
  const slug = result.stdout.trim();
  if (!slug) {
    throw new Error(`Could not resolve repo slug for ${repoPath}`);
  }
  return slug;
}

async function scanRepo(params: {
  companyId: string;
  company: CompanyEntry;
  repo: CompanyRepo;
  vercelScope?: string;
}): Promise<WorkFinding[]> {
  const repoPath = path.resolve(expandHome(params.repo.path));
  const findings: WorkFinding[] = [];

  try {
    const repoSlug = await resolveRepoSlug(repoPath);

    const issueResult = await runCommand("gh", [
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--limit",
      "10",
      "--json",
      "number,title,url,updatedAt,assignees",
    ]);
    const issues = JSON.parse(issueResult.stdout) as Array<{
      number: number;
      title: string;
      url: string;
      updatedAt: string;
      assignees?: Array<{ login: string }>;
    }>;
    for (const issue of issues) {
      if ((issue.assignees?.length ?? 0) > 0) {
        continue;
      }
      findings.push({
        kind: "issue",
        companyId: params.companyId,
        companyName: params.company.name,
        repoRole: params.repo.role,
        repoPath,
        repoSlug,
        title: issue.title,
        url: issue.url,
        number: issue.number,
        updatedAt: issue.updatedAt,
        summary: `[${params.company.name}] ${repoSlug} issue #${issue.number} is unassigned: ${issue.title}`,
      });
    }

    const prResult = await runCommand("gh", [
      "pr",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--limit",
      "10",
      "--json",
      "number,title,url,updatedAt",
    ]);
    const prs = JSON.parse(prResult.stdout) as Array<{
      number: number;
      title: string;
      url: string;
      updatedAt: string;
    }>;
    for (const pr of prs) {
      const ageDays = daysOld(pr.updatedAt);
      if (ageDays < STALE_PR_DAYS) {
        continue;
      }
      findings.push({
        kind: "stale_pr",
        companyId: params.companyId,
        companyName: params.company.name,
        repoRole: params.repo.role,
        repoPath,
        repoSlug,
        title: pr.title,
        url: pr.url,
        number: pr.number,
        updatedAt: pr.updatedAt,
        summary: `[${params.company.name}] ${repoSlug} PR #${pr.number} is stale (${Math.floor(ageDays)}d): ${pr.title}`,
      });
    }

    const branchResult = await runCommand("git", ["branch", "--show-current"], { cwd: repoPath });
    const statusResult = await runCommand("git", ["status", "--porcelain"], { cwd: repoPath });
    const dirtyEntries = statusResult.stdout
      .split("\n")
      .map((entry) => entry.trimEnd())
      .filter(Boolean);
    if (dirtyEntries.length > 0) {
      findings.push({
        kind: "dirty_repo",
        companyId: params.companyId,
        companyName: params.company.name,
        repoRole: params.repo.role,
        repoPath,
        repoSlug,
        branchName: branchResult.stdout.trim() || "(detached)",
        dirtyFiles: dirtyEntries.length,
        summary: `[${params.company.name}] ${repoSlug} has ${dirtyEntries.length} uncommitted file(s) on ${branchResult.stdout.trim() || "(detached)"}`,
      });
    }

    if (params.repo.vercelProject) {
      findings.push(
        ...(await scanVercelProject({
          companyId: params.companyId,
          company: params.company,
          repo: params.repo,
          repoPath,
          repoSlug,
          vercelScope: params.vercelScope,
        })),
      );
    }
  } catch (error) {
    findings.push({
      kind: "error",
      companyId: params.companyId,
      companyName: params.company.name,
      repoRole: params.repo.role,
      repoPath,
      summary: `[${params.company.name}] ${params.repo.role} scan failed: ${String(error)}`,
    });
  }

  return findings;
}

async function scanVercelProject(params: {
  companyId: string;
  company: CompanyEntry;
  repo: CompanyRepo;
  repoPath: string;
  repoSlug?: string;
  vercelScope?: string;
}): Promise<WorkFinding[]> {
  const findings: WorkFinding[] = [];
  const project = params.repo.vercelProject;
  if (!project) {
    return findings;
  }

  const scopeArgs = params.vercelScope ? ["--scope", params.vercelScope] : [];

  try {
    const deploymentResult = await runCommand("vercel", [
      "list",
      project,
      "--status",
      "ERROR",
      "--json",
      ...scopeArgs,
    ]);
    const deployments = JSON.parse(deploymentResult.stdout) as Array<{
      url?: string;
      state?: string;
      name?: string;
    }>;
    for (const deployment of deployments) {
      findings.push({
        kind: "vercel_error",
        companyId: params.companyId,
        companyName: params.company.name,
        repoRole: params.repo.role,
        repoPath: params.repoPath,
        repoSlug: params.repoSlug,
        project,
        deploymentUrl: deployment.url,
        state: deployment.state,
        summary: `[${params.company.name}] Vercel project ${project} has failed deployment${deployment.url ? `: ${deployment.url}` : ""}`,
      });
    }
  } catch (error) {
    findings.push({
      kind: "error",
      companyId: params.companyId,
      companyName: params.company.name,
      repoRole: params.repo.role,
      repoPath: params.repoPath,
      summary: `[${params.company.name}] Vercel deployment scan failed for ${project}: ${String(error)}`,
    });
  }

  try {
    const logsResult = await runCommand(
      "vercel",
      ["logs", "--level", "error", "--since", "1d", "--json", "--no-branch", ...scopeArgs],
      {
        cwd: params.repoPath,
      },
    );
    const raw = logsResult.stdout.trim();
    if (raw) {
      const logLines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 5);
      if (logLines.length > 0) {
        findings.push({
          kind: "vercel_error",
          companyId: params.companyId,
          companyName: params.company.name,
          repoRole: params.repo.role,
          repoPath: params.repoPath,
          repoSlug: params.repoSlug,
          project,
          summary: `[${params.company.name}] Vercel project ${project} has runtime/build log activity in the last day`,
        });
      }
    }
  } catch {
    // Logs can fail for unlinked repos or if no logs exist; don't turn that into scanner noise.
  }

  return findings;
}

export async function discoverWork(params: {
  api?: OpenClawPluginApi;
  companiesPath: string;
  companyFilter?: string;
}): Promise<{ findings: WorkFinding[]; companies: CompaniesFile["companies"] }> {
  const companiesFile = await loadCompanies(params.companiesPath);
  const findings: WorkFinding[] = [];
  const vercelScope = params.api ? resolveConductorConfig(params.api).vercelScope : undefined;

  for (const [companyId, company] of Object.entries(companiesFile.companies)) {
    if (params.companyFilter && companyId !== params.companyFilter) {
      continue;
    }
    for (const repo of company.repos) {
      findings.push(...(await scanRepo({ companyId, company, repo, vercelScope })));
    }
  }

  return { findings, companies: companiesFile.companies };
}

export function formatWorkDiscoveryReport(findings: WorkFinding[]): string {
  if (findings.length === 0) {
    return "No actionable work discovered across configured repos.";
  }

  const lines = ["Work Discovery Report", ""];
  const issues = findings.filter((finding) => finding.kind === "issue");
  const stalePrs = findings.filter((finding) => finding.kind === "stale_pr");
  const dirtyRepos = findings.filter((finding) => finding.kind === "dirty_repo");
  const vercelErrors = findings.filter((finding) => finding.kind === "vercel_error");
  const errors = findings.filter((finding) => finding.kind === "error");

  if (issues.length > 0) {
    lines.push("Unassigned issues:");
    for (const finding of issues) {
      lines.push(`- ${finding.summary}`);
    }
    lines.push("");
  }

  if (stalePrs.length > 0) {
    lines.push("Stale PRs:");
    for (const finding of stalePrs) {
      lines.push(`- ${finding.summary}`);
    }
    lines.push("");
  }

  if (dirtyRepos.length > 0) {
    lines.push("Dirty repos:");
    for (const finding of dirtyRepos) {
      lines.push(`- ${finding.summary}`);
    }
    lines.push("");
  }

  if (vercelErrors.length > 0) {
    lines.push("Vercel errors:");
    for (const finding of vercelErrors) {
      lines.push(`- ${finding.summary}`);
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push("Scan errors:");
    for (const finding of errors) {
      lines.push(`- ${finding.summary}`);
    }
  }

  return lines.join("\n").trim();
}
