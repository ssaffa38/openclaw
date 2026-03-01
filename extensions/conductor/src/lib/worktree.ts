import fs from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./paths.js";
import { commandExists, runCommand } from "./shell.js";

export type PreparedWorktree = {
  repoSlug: string;
  baseBranch: string;
  worktreePath: string;
};

async function ensureRepoExists(repoPath: string): Promise<void> {
  try {
    await fs.access(path.join(repoPath, ".git"));
  } catch {
    throw new Error(`Repo is not available at ${repoPath}`);
  }
}

async function ensurePackageManager(pm: string | null | undefined): Promise<void> {
  if (!pm) {
    return;
  }
  if (!(await commandExists(pm))) {
    throw new Error(`Package manager not available: ${pm}`);
  }
}

async function resolveRepoSlug(repoPath: string, repoSlug?: string): Promise<string> {
  if (repoSlug?.trim()) {
    return repoSlug.trim();
  }
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

async function ensurePushAccess(repoSlug: string): Promise<void> {
  const result = await runCommand("gh", [
    "repo",
    "view",
    repoSlug,
    "--json",
    "viewerPermission",
    "--jq",
    ".viewerPermission",
  ]);
  const permission = result.stdout.trim();
  if (permission !== "WRITE" && permission !== "ADMIN" && permission !== "MAINTAIN") {
    throw new Error(`Insufficient GitHub permission for ${repoSlug}: ${permission || "unknown"}`);
  }
}

async function resolveBaseBranch(repoSlug: string): Promise<string> {
  const result = await runCommand("gh", [
    "repo",
    "view",
    repoSlug,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  const baseBranch = result.stdout.trim();
  if (!baseBranch) {
    throw new Error(`Could not determine default branch for ${repoSlug}`);
  }
  return baseBranch;
}

export async function prepareWorktree(params: {
  repoPath: string;
  repoSlug?: string;
  branchName: string;
  taskId: string;
  worktreeRoot: string;
  pm?: string | null;
}): Promise<PreparedWorktree> {
  const repoPath = path.resolve(expandHome(params.repoPath));
  await ensureRepoExists(repoPath);
  await ensurePackageManager(params.pm);

  const resolvedRepoSlug = await resolveRepoSlug(repoPath, params.repoSlug);
  await ensurePushAccess(resolvedRepoSlug);
  const baseBranch = await resolveBaseBranch(resolvedRepoSlug);

  await runCommand("git", ["fetch", "origin"], { cwd: repoPath });

  const worktreePath = path.join(params.worktreeRoot, params.taskId);
  try {
    await fs.access(worktreePath);
    throw new Error(`Worktree already exists: ${worktreePath}`);
  } catch (error) {
    const details = error as NodeJS.ErrnoException;
    if (details.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(params.worktreeRoot, { recursive: true });
  await runCommand(
    "git",
    ["worktree", "add", worktreePath, "-b", params.branchName, `origin/${baseBranch}`],
    { cwd: repoPath },
  );

  if (params.pm) {
    await runCommand(params.pm, ["install"], { cwd: worktreePath });
  }

  return {
    repoSlug: resolvedRepoSlug,
    baseBranch,
    worktreePath,
  };
}

export async function removeWorktree(params: {
  repoPath: string;
  worktreePath: string;
}): Promise<void> {
  const repoPath = path.resolve(expandHome(params.repoPath));
  try {
    await fs.access(params.worktreePath);
  } catch {
    return;
  }
  await runCommand("git", ["worktree", "remove", params.worktreePath, "--force"], {
    cwd: repoPath,
  });
  await runCommand("git", ["worktree", "prune"], { cwd: repoPath }).catch(() => undefined);
}
