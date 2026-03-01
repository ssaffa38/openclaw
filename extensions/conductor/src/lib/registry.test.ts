import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRegistry, removeTask, upsertTask } from "./registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeTask(id: string, startedAt: number) {
  return {
    id,
    company: "demo",
    repoSlug: "sj/demo",
    repoPath: "/tmp/demo",
    baseBranch: "main",
    branchName: `conductor/${id}`,
    tmuxSession: `conductor-${id}`,
    worktree: `/tmp/${id}`,
    modelTier: 2,
    model: "claude-sonnet-4-5-20250929",
    prompt: "Do the thing",
    startedAt,
    status: "running" as const,
    retries: 0,
    pr: { number: null, url: null, lastCommitSha: null },
    checks: { tmuxAlive: true, prCreated: false, ciStatus: null, reviews: [] },
  };
}

describe("registry", () => {
  it("creates, sorts, updates, and removes tasks", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-registry-"));
    tempDirs.push(tempDir);
    const tasksPath = path.join(tempDir, "active-tasks.json");

    await upsertTask(tasksPath, makeTask("older", 100));
    await upsertTask(tasksPath, makeTask("newer", 200));
    await upsertTask(tasksPath, { ...makeTask("older", 300), status: "failed" });

    let registry = await readRegistry(tasksPath);
    expect(registry.tasks.map((task) => task.id)).toEqual(["older", "newer"]);
    expect(registry.tasks[0]?.status).toBe("failed");

    await removeTask(tasksPath, "newer");
    registry = await readRegistry(tasksPath);
    expect(registry.tasks.map((task) => task.id)).toEqual(["older"]);
  });
});
