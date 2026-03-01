import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const loadCompanies = vi.fn();

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/company-loader.js", () => ({
  loadCompanies,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function fakeApi() {
  return {
    id: "conductor",
    name: "conductor",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    resolvePath(input: string) {
      return input;
    },
  };
}

describe("conductor_update_experiment", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    loadCompanies.mockReset();
  });

  it("creates a new experiment record", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-exp-create-"));
    tempDirs.push(tempDir);
    const experimentsPath = path.join(tempDir, "experiments.json");
    await fs.writeFile(experimentsPath, JSON.stringify({ experiments: [] }));

    resolveConductorConfig.mockReturnValue({
      experimentsPath,
      companiesPath: "/tmp/companies.json",
    });
    loadCompanies.mockResolvedValue({
      companies: {
        "revive-ai": { name: "Revive AI", type: "portfolio-co", repos: [] },
      },
    });

    const { createUpdateExperimentTool } = await import("./update-experiment.js");
    const tool = createUpdateExperimentTool(fakeApi() as never);
    const result = await tool.execute("id", {
      id: "exp-revive-pricing-v2",
      company: "revive-ai",
      hypothesis: "Usage-based pricing increases trial-to-paid",
      status: "running",
      metrics: {
        trialToPaid: { baseline: 0.12, current: 0.15 },
      },
    });

    const saved = JSON.parse(await fs.readFile(experimentsPath, "utf8")) as {
      experiments: Array<{ id: string; company: string }>;
    };

    expect(saved.experiments).toHaveLength(1);
    expect(saved.experiments[0]).toMatchObject({
      id: "exp-revive-pricing-v2",
      company: "revive-ai",
    });
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.created).toBe(true);
  });

  it("updates an existing experiment record without replacing omitted fields", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-exp-update-"));
    tempDirs.push(tempDir);
    const experimentsPath = path.join(tempDir, "experiments.json");
    await fs.writeFile(
      experimentsPath,
      JSON.stringify({
        experiments: [
          {
            id: "exp-revive-pricing-v2",
            company: "revive-ai",
            hypothesis: "Original hypothesis",
            status: "running",
            notes: "Early signal positive.",
          },
        ],
      }),
    );

    resolveConductorConfig.mockReturnValue({
      experimentsPath,
      companiesPath: "/tmp/companies.json",
    });
    loadCompanies.mockResolvedValue({
      companies: {
        "revive-ai": { name: "Revive AI", type: "portfolio-co", repos: [] },
      },
    });

    const { createUpdateExperimentTool } = await import("./update-experiment.js");
    const tool = createUpdateExperimentTool(fakeApi() as never);
    await tool.execute("id", {
      id: "exp-revive-pricing-v2",
      company: "revive-ai",
      status: "holding",
      nextReview: "2026-03-15",
    });

    const saved = JSON.parse(await fs.readFile(experimentsPath, "utf8")) as {
      experiments: Array<{ status: string; notes?: string; nextReview?: string }>;
    };

    expect(saved.experiments[0]).toMatchObject({
      status: "holding",
      notes: "Early signal positive.",
      nextReview: "2026-03-15",
    });
  });
});
