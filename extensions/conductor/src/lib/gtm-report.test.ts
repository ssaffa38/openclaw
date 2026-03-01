import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const loadCompanies = vi.fn();

vi.mock("./config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("./company-loader.js", () => ({
  loadCompanies,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("gtm report", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    loadCompanies.mockReset();
  });

  it("builds GTM entries from snapshots and experiments", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-gtm-"));
    tempDirs.push(tempDir);
    const experimentsPath = path.join(tempDir, "experiments.json");
    const snapshotPath = path.join(tempDir, "gtm-snapshot.json");

    await fs.writeFile(
      experimentsPath,
      JSON.stringify({
        experiments: [
          {
            id: "exp-revive-pricing-v2",
            company: "revive-ai",
            hypothesis: "Test pricing",
            status: "running",
            metrics: {
              trialToPaid: { baseline: 0.12, current: 0.15 },
            },
          },
        ],
      }),
    );
    await fs.writeFile(
      snapshotPath,
      JSON.stringify({
        companies: {
          "ct-networks": {
            pipelineValue: 47000,
            activeDeals: 8,
            staleDeals: [{ name: "Energy Disruptors", stage: "Proposal Sent", daysStale: 8 }],
          },
          "revive-ai": {
            pendingReplies: [{ name: "MongoDB", source: "apollo", summary: "Needs follow-up" }],
          },
        },
      }),
    );

    resolveConductorConfig.mockReturnValue({
      companiesPath: "/tmp/companies.json",
      experimentsPath,
      gtmSnapshotPath: snapshotPath,
    });
    loadCompanies.mockResolvedValue({
      companies: {
        "ct-networks": { name: "CT Networks", type: "b2b-platform", repos: [] },
        "revive-ai": { name: "Revive AI", type: "portfolio-co", repos: [] },
        nimbus: { name: "Nimbus Creative", type: "agency", repos: [] },
      },
    });

    const { buildGtmReport, formatGtmReport } = await import("./gtm-report.js");
    const result = await buildGtmReport({ api: {} as never });

    expect(result.entries).toHaveLength(2);
    expect(formatGtmReport(result.entries)).toContain("GTM Status");
    expect(formatGtmReport(result.entries)).toContain("CT Networks");
    expect(formatGtmReport(result.entries)).toContain("Revive AI");
    expect(formatGtmReport(result.entries)).toContain("exp-revive-pricing-v2");
  });

  it("returns an empty fallback when no GTM data exists", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-gtm-empty-"));
    tempDirs.push(tempDir);
    const experimentsPath = path.join(tempDir, "experiments.json");
    const snapshotPath = path.join(tempDir, "gtm-snapshot.json");

    await fs.writeFile(experimentsPath, JSON.stringify({ experiments: [] }));
    await fs.writeFile(snapshotPath, JSON.stringify({ companies: {} }));

    resolveConductorConfig.mockReturnValue({
      companiesPath: "/tmp/companies.json",
      experimentsPath,
      gtmSnapshotPath: snapshotPath,
    });
    loadCompanies.mockResolvedValue({
      companies: {
        nimbus: { name: "Nimbus Creative", type: "agency", repos: [] },
      },
    });

    const { buildGtmReport, formatGtmReport } = await import("./gtm-report.js");
    const result = await buildGtmReport({ api: {} as never });

    expect(result.entries).toHaveLength(0);
    expect(formatGtmReport(result.entries)).toBe("No GTM status available.");
  });
});
