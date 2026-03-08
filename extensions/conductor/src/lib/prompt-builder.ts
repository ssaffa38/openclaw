import fs from "node:fs/promises";
import path from "node:path";
import type { CompanyEntry, CompanyRepo } from "../types.js";

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

async function loadRepoInstructions(repoPath: string): Promise<string[]> {
  const candidates = ["CLAUDE.md", "AGENTS.md"].map((name) => path.join(repoPath, name));
  const snippets: string[] = [];
  for (const filePath of candidates) {
    const content = await readIfPresent(filePath);
    if (content) {
      snippets.push(`File: ${path.basename(filePath)}\n${content}`);
    }
  }
  return snippets;
}

export async function buildPrompt(params: {
  companyId: string;
  company: CompanyEntry;
  repo: CompanyRepo;
  task: string;
  repoPath: string;
  baseBranch: string;
  branchName: string;
  repoSlug: string;
  vaultContext?: string;
}): Promise<string> {
  const repoInstructions = await loadRepoInstructions(params.repoPath);
  const lines = [
    "You are a Conductor-spawned coding agent.",
    `Company key: ${params.companyId}`,
    `Company: ${params.company.name}`,
    `Company type: ${params.company.type}`,
    `Repo role: ${params.repo.role}`,
    `Repo: ${params.repoPath}`,
    `Task: ${params.task}`,
    `Base branch: ${params.baseBranch}`,
    `Branch: ${params.branchName}`,
  ];

  if (params.repo.context) {
    lines.push(`Business context: ${params.repo.context}`);
  }
  if (params.company.keywords?.length) {
    lines.push(`Company keywords: ${params.company.keywords.join(", ")}`);
  }
  if (params.company.integrations?.length || params.repo.integrations?.length) {
    lines.push(
      `Relevant integrations: ${[...(params.company.integrations ?? []), ...(params.repo.integrations ?? [])].join(", ")}`,
    );
  }

  if (params.vaultContext) {
    lines.push("", params.vaultContext);
  }

  lines.push(
    "Constraints:",
    "- Follow the existing codebase patterns.",
    "- Do not touch unrelated files.",
    "- Run relevant tests if they exist.",
    "- Prefer the repository instruction files below over generic assumptions.",
    "- When the work is complete: git add, commit, push, and create a PR.",
    `- PR command: gh pr create --repo ${params.repoSlug} --base ${params.baseBranch} --head ${params.branchName} --title "..." --body "## Summary\\n..."`,
  );

  if (repoInstructions.length > 0) {
    lines.push("Repository instructions:", repoInstructions.join("\n\n---\n\n"));
  }

  return lines.join("\n");
}
