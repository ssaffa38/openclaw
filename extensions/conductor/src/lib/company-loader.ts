import fs from "node:fs/promises";
import path from "node:path";
import type { CompaniesFile, CompanyRepo } from "../types.js";

export async function loadCompanies(companiesPath: string): Promise<CompaniesFile> {
  const raw = await fs.readFile(companiesPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<CompaniesFile>;
  if (!parsed || typeof parsed !== "object" || !parsed.companies) {
    throw new Error(`Invalid companies config: ${companiesPath}`);
  }
  return parsed as CompaniesFile;
}

export function resolveCompanyRepo(params: {
  companies: CompaniesFile;
  companyId: string;
  repoRole?: string;
  repoPath?: string;
}): { company: CompaniesFile["companies"][string]; repo: CompanyRepo } {
  const company = params.companies.companies[params.companyId];
  if (!company) {
    throw new Error(`Unknown company: ${params.companyId}`);
  }

  const normalizedRepoPath = params.repoPath ? path.resolve(params.repoPath) : undefined;
  let candidates = company.repos;

  if (params.repoRole) {
    candidates = candidates.filter((repo) => repo.role === params.repoRole);
  }
  if (normalizedRepoPath) {
    candidates = candidates.filter((repo) => path.resolve(repo.path) === normalizedRepoPath);
  }

  if (candidates.length === 0) {
    throw new Error(`No repo matched for company ${params.companyId}`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `Company ${params.companyId} has multiple repos; pass repoRole or repoPath explicitly`,
    );
  }

  return { company, repo: candidates[0] };
}
