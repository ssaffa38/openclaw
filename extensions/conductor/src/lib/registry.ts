import fs from "node:fs/promises";
import path from "node:path";
import type { ConductorTask, TaskRegistryFile } from "../types.js";

const EMPTY_REGISTRY: TaskRegistryFile = { tasks: [] };

export async function readRegistry(tasksPath: string): Promise<TaskRegistryFile> {
  try {
    const raw = await fs.readFile(tasksPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TaskRegistryFile>;
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { ...EMPTY_REGISTRY };
    }
    return {
      tasks: parsed.tasks.toSorted((a, b) => b.startedAt - a.startedAt),
    };
  } catch (error) {
    const details = error as NodeJS.ErrnoException;
    if (details.code === "ENOENT") {
      return { ...EMPTY_REGISTRY };
    }
    throw error;
  }
}

export async function writeRegistry(tasksPath: string, registry: TaskRegistryFile): Promise<void> {
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  const tempPath = `${tasksPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, tasksPath);
}

export async function upsertTask(tasksPath: string, task: ConductorTask): Promise<ConductorTask> {
  const registry = await readRegistry(tasksPath);
  const existingIndex = registry.tasks.findIndex((entry) => entry.id === task.id);
  if (existingIndex >= 0) {
    registry.tasks[existingIndex] = task;
  } else {
    registry.tasks.push(task);
  }
  registry.tasks = registry.tasks.toSorted((a, b) => b.startedAt - a.startedAt);
  await writeRegistry(tasksPath, registry);
  return task;
}

export async function getTask(tasksPath: string, taskId: string): Promise<ConductorTask | null> {
  const registry = await readRegistry(tasksPath);
  return registry.tasks.find((task) => task.id === taskId) ?? null;
}

export async function removeTask(tasksPath: string, taskId: string): Promise<ConductorTask | null> {
  const registry = await readRegistry(tasksPath);
  const existing = registry.tasks.find((task) => task.id === taskId) ?? null;
  if (!existing) {
    return null;
  }
  registry.tasks = registry.tasks.filter((task) => task.id !== taskId);
  await writeRegistry(tasksPath, registry);
  return existing;
}
