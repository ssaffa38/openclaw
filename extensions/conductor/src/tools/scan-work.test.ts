import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const discoverWork = vi.fn();
const formatWorkDiscoveryReport = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/scan-work.js", () => ({
  discoverWork,
  formatWorkDiscoveryReport,
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

describe("conductor_scan_work", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    discoverWork.mockReset();
    formatWorkDiscoveryReport.mockReset();
    notifyDiscord.mockReset();

    resolveConductorConfig.mockReturnValue({
      companiesPath: "/tmp/companies.json",
    });
    discoverWork.mockResolvedValue({ findings: [{ kind: "issue" }] });
    formatWorkDiscoveryReport.mockReturnValue("Work Discovery Report");
    notifyDiscord.mockResolvedValue(true);
  });

  it("scans work and optionally notifies war-room", async () => {
    const { createScanWorkTool } = await import("./scan-work.js");
    const tool = createScanWorkTool(fakeApi() as never);

    const result = await tool.execute("id", { company: "demo", notify: true });

    expect(discoverWork).toHaveBeenCalledWith({
      api: expect.anything(),
      companiesPath: "/tmp/companies.json",
      companyFilter: "demo",
    });
    expect(notifyDiscord).toHaveBeenCalledWith(expect.anything(), {
      audience: "warRoom",
      text: "Work Discovery Report",
    });
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.notified).toBe(true);
  });
});
