import { describe, expect, it } from "vitest";
import { resolveCompanyRepo } from "./company-loader.js";

const companies = {
  companies: {
    demo: {
      name: "Demo",
      type: "test",
      repos: [
        { path: "/tmp/a", role: "web", pm: "npm" },
        { path: "/tmp/b", role: "api", pm: "npm" },
      ],
    },
  },
};

describe("resolveCompanyRepo", () => {
  it("resolves a repo by role", () => {
    const result = resolveCompanyRepo({
      companies,
      companyId: "demo",
      repoRole: "api",
    });
    expect(result.repo.path).toBe("/tmp/b");
  });

  it("requires an explicit repo selector when multiple repos exist", () => {
    expect(() =>
      resolveCompanyRepo({
        companies,
        companyId: "demo",
      }),
    ).toThrow(/multiple repos/);
  });
});
