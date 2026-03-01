import { beforeEach, describe, expect, it, vi } from "vitest";

const buildGtmReport = vi.fn();
const formatGtmReport = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("../lib/gtm-report.js", () => ({
  buildGtmReport,
  formatGtmReport,
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

describe("conductor_gtm_report", () => {
  beforeEach(() => {
    buildGtmReport.mockReset();
    formatGtmReport.mockReset();
    notifyDiscord.mockReset();

    buildGtmReport.mockResolvedValue({ entries: [{ companyId: "revive-ai" }] });
    formatGtmReport.mockReturnValue("GTM Status");
    notifyDiscord.mockResolvedValue(true);
  });

  it("builds and optionally notifies a GTM report", async () => {
    const { createGtmReportTool } = await import("./gtm-report.js");
    const tool = createGtmReportTool(fakeApi() as never);

    const result = await tool.execute("id", { company: "revive-ai", notify: true });

    expect(buildGtmReport).toHaveBeenCalledWith({
      api: expect.anything(),
      companyFilter: "revive-ai",
    });
    expect(notifyDiscord).toHaveBeenCalledWith(expect.anything(), {
      audience: "private",
      text: "GTM Status",
    });
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.notified).toBe(true);
  });
});
