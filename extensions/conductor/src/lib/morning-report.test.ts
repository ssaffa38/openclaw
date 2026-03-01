import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const buildCompanyStatus = vi.fn();
const buildGtmReport = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("./config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("./company-status.js", () => ({
  buildCompanyStatus,
}));

vi.mock("./gtm-report.js", () => ({
  buildGtmReport,
}));

vi.mock("./notifier.js", () => ({
  notifyDiscord,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("morning report", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    buildCompanyStatus.mockReset();
    buildGtmReport.mockReset();
    notifyDiscord.mockReset();

    resolveConductorConfig.mockReturnValue({
      morningReportEnabled: true,
      morningReportHourLocal: 0,
    });
    buildCompanyStatus.mockResolvedValue({
      entries: [
        {
          companyName: "Demo Co",
          activeTasks: [{ id: "task-1", status: "running", pr: { number: null } }],
          readyTasks: [{ id: "task-2", status: "ready", pr: { number: 42 } }],
          findings: [{ kind: "vercel_error", summary: "build failed" }],
        },
      ],
    });
    buildGtmReport.mockResolvedValue({
      entries: [
        {
          companyName: "Revive AI",
          snapshot: {
            pipelineValue: 18000,
            activeDeals: 3,
            pendingReplies: [{ name: "MongoDB" }],
          },
          experiments: [{ id: "exp-revive-pricing-v2" }],
        },
      ],
    });
    notifyDiscord.mockResolvedValue(true);
  });

  it("formats a digest with engineering, GTM summary, and priorities", async () => {
    const { buildMorningReport } = await import("./morning-report.js");
    const result = await buildMorningReport({} as never);

    expect(result.report).toContain("Morning Report");
    expect(result.report).toContain("Engineering:");
    expect(result.report).toContain("GTM:");
    expect(result.report).toContain("Priority suggestions:");
  });

  it("sends at most one morning report per day", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-morning-report-"));
    tempDirs.push(tempDir);

    const { maybeSendMorningReport } = await import("./morning-report.js");
    await expect(maybeSendMorningReport({} as never, tempDir)).resolves.toBe(true);
    await expect(maybeSendMorningReport({} as never, tempDir)).resolves.toBe(false);
    expect(notifyDiscord).toHaveBeenCalledTimes(1);
  });
});
