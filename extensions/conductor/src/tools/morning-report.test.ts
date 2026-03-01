import { beforeEach, describe, expect, it, vi } from "vitest";

const buildMorningReport = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("../lib/morning-report.js", () => ({
  buildMorningReport,
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

describe("conductor_morning_report", () => {
  beforeEach(() => {
    buildMorningReport.mockReset();
    notifyDiscord.mockReset();

    buildMorningReport.mockResolvedValue({
      entries: [{ companyId: "demo" }],
      report: "Morning Report",
    });
    notifyDiscord.mockResolvedValue(true);
  });

  it("builds and optionally sends the morning report", async () => {
    const { createMorningReportTool } = await import("./morning-report.js");
    const tool = createMorningReportTool(fakeApi() as never);

    const result = await tool.execute("id", { notify: true });

    expect(buildMorningReport).toHaveBeenCalledWith(expect.anything());
    expect(notifyDiscord).toHaveBeenCalledWith(expect.anything(), {
      audience: "private",
      text: "Morning Report",
    });
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.notified).toBe(true);
  });
});
