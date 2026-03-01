import { beforeEach, describe, expect, it, vi } from "vitest";

const buildCompanyStatus = vi.fn();
const formatCompanyStatusReport = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("../lib/company-status.js", () => ({
  buildCompanyStatus,
  formatCompanyStatusReport,
}));

vi.mock("../lib/notifier.js", () => ({
  notifyDiscord,
}));

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

describe("conductor_company_status", () => {
  beforeEach(() => {
    buildCompanyStatus.mockReset();
    formatCompanyStatusReport.mockReset();
    notifyDiscord.mockReset();

    buildCompanyStatus.mockResolvedValue({ entries: [{ companyId: "demo" }] });
    formatCompanyStatusReport.mockReturnValue("Portfolio Status");
    notifyDiscord.mockResolvedValue(true);
  });

  it("builds and optionally notifies a company status report", async () => {
    const { createCompanyStatusTool } = await import("./company-status.js");
    const tool = createCompanyStatusTool(fakeApi() as never);

    const result = await tool.execute("id", { company: "demo", notify: true });

    expect(buildCompanyStatus).toHaveBeenCalledWith({
      api: expect.anything(),
      companyFilter: "demo",
    });
    expect(notifyDiscord).toHaveBeenCalledWith(expect.anything(), {
      audience: "warRoom",
      text: "Portfolio Status",
    });
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.notified).toBe(true);
  });
});
