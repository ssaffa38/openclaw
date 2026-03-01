import { describe, expect, it } from "vitest";
import { resolveSpawnModelRoute } from "./model-router.js";

const company = {
  name: "Demo Co",
  type: "test",
  repos: [],
};

describe("resolveSpawnModelRoute", () => {
  it("routes heavy refactors to tier 1", () => {
    const route = resolveSpawnModelRoute({
      task: "Refactor the entire booking system across multiple files and services",
      repo: { path: "/tmp/repo", role: "platform" },
      company,
      defaultModel: "claude-sonnet-4-5-20250929",
    });

    expect(route).toEqual({
      tier: 1,
      model: "claude-opus-4-5",
      reason: "heavy multi-step or architectural task",
    });
  });

  it("routes lightweight docs tasks to tier 4 fallback", () => {
    const route = resolveSpawnModelRoute({
      task: "Write the PR description and changelog for this fix",
      repo: { path: "/tmp/repo", role: "web" },
      company,
      defaultModel: "claude-sonnet-4-5-20250929",
    });

    expect(route.tier).toBe(4);
    expect(route.model).toBe("claude-haiku-4-5-20251001");
  });

  it("uses the default model for standard tasks", () => {
    const route = resolveSpawnModelRoute({
      task: "Add a new API endpoint with tests",
      repo: { path: "/tmp/repo", role: "web" },
      company,
      defaultModel: "claude-sonnet-4-5-20250929",
    });

    expect(route).toEqual({
      tier: 2,
      model: "claude-sonnet-4-5-20250929",
      reason: "standard task for Demo Co web repo",
    });
  });

  it("honors explicit model overrides first", () => {
    const route = resolveSpawnModelRoute({
      task: "Fix the homepage spacing",
      repo: { path: "/tmp/repo", role: "web" },
      company,
      defaultModel: "claude-sonnet-4-5-20250929",
      explicitModel: "claude-haiku-4-5-20251001",
      explicitModelTier: 3,
    });

    expect(route).toEqual({
      tier: 3,
      model: "claude-haiku-4-5-20251001",
      reason: "explicit model override",
    });
  });
});
