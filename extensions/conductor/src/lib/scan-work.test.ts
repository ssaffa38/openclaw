import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const loadCompanies = vi.fn();
const runCommand = vi.fn();

vi.mock("./config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("./company-loader.js", () => ({
  loadCompanies,
}));

vi.mock("./shell.js", () => ({
  runCommand,
}));

describe("discoverWork", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    loadCompanies.mockReset();
    runCommand.mockReset();
    resolveConductorConfig.mockReturnValue({ vercelScope: "saffa-co" });
  });

  it("collects unassigned issues, stale PRs, and dirty repo findings", async () => {
    loadCompanies.mockResolvedValue({
      companies: {
        demo: {
          name: "Demo Co",
          type: "test",
          repos: [{ path: "/tmp/repo", role: "web", pm: "npm", vercelProject: "demo-web" }],
        },
      },
    });

    runCommand.mockImplementation(async (command: string, args: string[]) => {
      if (command === "gh" && args[0] === "repo") {
        return { stdout: "sj/demo\n", stderr: "" };
      }
      if (command === "gh" && args[0] === "issue") {
        return {
          stdout: JSON.stringify([
            {
              number: 12,
              title: "Fix login copy",
              url: "https://github.com/sj/demo/issues/12",
              updatedAt: "2026-02-20T00:00:00.000Z",
              assignees: [],
            },
          ]),
          stderr: "",
        };
      }
      if (command === "gh" && args[0] === "pr") {
        return {
          stdout: JSON.stringify([
            {
              number: 7,
              title: "Add speaker bio field",
              url: "https://github.com/sj/demo/pull/7",
              updatedAt: "2026-02-20T00:00:00.000Z",
            },
          ]),
          stderr: "",
        };
      }
      if (command === "git" && args[0] === "branch") {
        return { stdout: "feature/demo\n", stderr: "" };
      }
      if (command === "git" && args[0] === "status") {
        return { stdout: " M src/app/page.tsx\n?? notes.txt\n", stderr: "" };
      }
      if (command === "vercel" && args[0] === "list") {
        return {
          stdout: JSON.stringify([
            {
              url: "demo-web-git-main.vercel.app",
              state: "ERROR",
            },
          ]),
          stderr: "",
        };
      }
      if (command === "vercel" && args[0] === "logs") {
        return {
          stdout: '{"level":"error","message":"TypeError"}\n',
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    const { discoverWork, formatWorkDiscoveryReport } = await import("./scan-work.js");
    const result = await discoverWork({ api: {} as never, companiesPath: "/tmp/companies.json" });

    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "issue",
      "stale_pr",
      "dirty_repo",
      "vercel_error",
      "vercel_error",
    ]);
    expect(formatWorkDiscoveryReport(result.findings)).toContain("Unassigned issues:");
    expect(formatWorkDiscoveryReport(result.findings)).toContain("Stale PRs:");
    expect(formatWorkDiscoveryReport(result.findings)).toContain("Dirty repos:");
    expect(formatWorkDiscoveryReport(result.findings)).toContain("Vercel errors:");
  });

  it("records scan failures as error findings", async () => {
    loadCompanies.mockResolvedValue({
      companies: {
        demo: {
          name: "Demo Co",
          type: "test",
          repos: [{ path: "/tmp/repo", role: "web", pm: "npm", vercelProject: "demo-web" }],
        },
      },
    });
    runCommand.mockRejectedValue(new Error("gh unavailable"));

    const { discoverWork } = await import("./scan-work.js");
    const result = await discoverWork({ api: {} as never, companiesPath: "/tmp/companies.json" });

    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: "error",
      }),
    ]);
  });
});
