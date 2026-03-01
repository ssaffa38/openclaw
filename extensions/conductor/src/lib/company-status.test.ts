import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const loadCompanies = vi.fn();
const readRegistry = vi.fn();
const discoverWork = vi.fn();

vi.mock("./config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("./company-loader.js", () => ({
  loadCompanies,
}));

vi.mock("./registry.js", () => ({
  readRegistry,
}));

vi.mock("./scan-work.js", () => ({
  discoverWork,
}));

describe("company status", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    loadCompanies.mockReset();
    readRegistry.mockReset();
    discoverWork.mockReset();

    resolveConductorConfig.mockReturnValue({
      companiesPath: "/tmp/companies.json",
      tasksPath: "/tmp/active-tasks.json",
    });
    loadCompanies.mockResolvedValue({
      companies: {
        demo: {
          name: "Demo Co",
          type: "test",
          repos: [],
        },
        other: {
          name: "Other Co",
          type: "test",
          repos: [],
        },
      },
    });
    readRegistry.mockResolvedValue({
      tasks: [
        { id: "task-1", company: "demo", status: "running" },
        { id: "task-2", company: "demo", status: "ready", pr: { number: 42 } },
        { id: "task-3", company: "other", status: "merged" },
      ],
    });
    discoverWork.mockResolvedValue({
      findings: [
        { companyId: "demo", kind: "issue" },
        { companyId: "demo", kind: "stale_pr" },
        { companyId: "other", kind: "vercel_error" },
      ],
    });
  });

  it("builds company entries from tasks and findings", async () => {
    const { buildCompanyStatus, formatCompanyStatusReport } = await import("./company-status.js");
    const result = await buildCompanyStatus({ api: {} as never });

    expect(result.entries[0]).toEqual(
      expect.objectContaining({
        companyId: "demo",
        activeTasks: expect.arrayContaining([
          expect.objectContaining({ id: "task-1" }),
          expect.objectContaining({ id: "task-2" }),
        ]),
      }),
    );
    expect(formatCompanyStatusReport(result.entries)).toContain("Portfolio Status");
    expect(formatCompanyStatusReport(result.entries)).toContain("Demo Co");
  });

  it("supports filtering to a single company", async () => {
    const { buildCompanyStatus } = await import("./company-status.js");
    const result = await buildCompanyStatus({ api: {} as never, companyFilter: "demo" });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.companyId).toBe("demo");
  });
});
