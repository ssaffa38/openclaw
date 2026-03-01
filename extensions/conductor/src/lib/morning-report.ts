import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { fetchPosts } from "./blog-client.js";
import { buildCompanyStatus } from "./company-status.js";
import { resolveConductorConfig } from "./config.js";
import { buildGtmReport } from "./gtm-report.js";
import { notifyDiscord } from "./notifier.js";

type PriorityItem = {
  companyName: string;
  text: string;
  score: number;
};

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPriorityList(
  entries: Awaited<ReturnType<typeof buildCompanyStatus>>["entries"],
  gtmEntries: Awaited<ReturnType<typeof buildGtmReport>>["entries"],
): PriorityItem[] {
  const items: PriorityItem[] = [];

  for (const entry of entries) {
    for (const task of entry.readyTasks) {
      items.push({
        companyName: entry.companyName,
        text: `Merge ready task ${task.id}${task.pr?.number ? ` (PR #${task.pr.number})` : ""}`,
        score: 90,
      });
    }
    for (const finding of entry.findings) {
      switch (finding.kind) {
        case "vercel_error":
          items.push({
            companyName: entry.companyName,
            text: finding.summary,
            score: 100,
          });
          break;
        case "stale_pr":
          items.push({
            companyName: entry.companyName,
            text: finding.summary,
            score: 80,
          });
          break;
        case "issue":
          items.push({
            companyName: entry.companyName,
            text: finding.summary,
            score: 60,
          });
          break;
        default:
          break;
      }
    }
  }

  for (const entry of gtmEntries) {
    for (const deal of entry.snapshot?.staleDeals ?? []) {
      items.push({
        companyName: entry.companyName,
        text: `Follow up stale deal ${deal.name}${deal.stage ? ` (${deal.stage})` : ""}`,
        score: 85,
      });
    }
    for (const reply of entry.snapshot?.pendingReplies ?? []) {
      items.push({
        companyName: entry.companyName,
        text: `Reply needed: ${reply.name}`,
        score: 95,
      });
    }
  }

  return items.toSorted((a, b) => b.score - a.score).slice(0, 4);
}

async function buildBlogSection(
  blogConfig: Record<string, { apiBase: string; enabled?: boolean }>,
): Promise<string[]> {
  const lines: string[] = [];
  for (const [key, site] of Object.entries(blogConfig)) {
    if (site.enabled === false) continue;
    try {
      const posts = await fetchPosts(site, "all");
      const published = posts.filter((p) => p.status === "published").length;
      const drafts = posts.filter((p) => p.status === "draft").length;

      const recentPublished = posts
        .filter((p) => p.status === "published" && p.published_at)
        .sort((a, b) => {
          const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
          const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
          return tb - ta;
        });

      const parts = [`${published} published`, `${drafts} draft(s)`];
      if (recentPublished.length > 0) {
        const latest = recentPublished[0];
        const daysAgo = Math.floor(
          (Date.now() - new Date(latest.published_at!).getTime()) / 86_400_000,
        );
        const ago = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
        parts.push(`latest: "${latest.title}" (${ago})`);
      }

      lines.push(`- [${key}] ${parts.join(" | ")}`);
    } catch {
      lines.push(`- [${key}] Unable to reach blog API`);
    }
  }
  return lines;
}

export async function buildMorningReport(api: OpenClawPluginApi): Promise<{
  entries: Awaited<ReturnType<typeof buildCompanyStatus>>["entries"];
  report: string;
}> {
  const [status, gtm] = await Promise.all([buildCompanyStatus({ api }), buildGtmReport({ api })]);
  const lines = [`Morning Report - ${new Date().toLocaleDateString()}`, ""];
  const engineering: string[] = [];
  const gtmLines: string[] = [];

  for (const entry of status.entries) {
    const ready = entry.readyTasks.length;
    const vercel = entry.findings.filter((finding) => finding.kind === "vercel_error").length;
    const stalePrs = entry.findings.filter((finding) => finding.kind === "stale_pr").length;
    const issues = entry.findings.filter((finding) => finding.kind === "issue").length;
    const active = entry.activeTasks.length;

    if (ready || vercel || stalePrs || issues || active) {
      const parts = [];
      if (active) {
        parts.push(`${active} active task(s)`);
      }
      if (ready) {
        parts.push(`${ready} ready`);
      }
      if (vercel) {
        parts.push(`${vercel} Vercel issue(s)`);
      }
      if (stalePrs) {
        parts.push(`${stalePrs} stale PR(s)`);
      }
      if (issues) {
        parts.push(`${issues} issue(s)`);
      }
      engineering.push(`- [${entry.companyName}] ${parts.join(" | ")}`);
    }
  }

  lines.push("Engineering:");
  if (engineering.length === 0) {
    lines.push("- No notable engineering changes this morning.");
  } else {
    lines.push(...engineering);
  }
  lines.push("");

  for (const entry of gtm.entries) {
    const parts = [];
    if (
      typeof entry.snapshot?.pipelineValue === "number" ||
      typeof entry.snapshot?.activeDeals === "number"
    ) {
      const pipelineValue =
        typeof entry.snapshot?.pipelineValue === "number"
          ? `$${Math.round(entry.snapshot.pipelineValue).toLocaleString("en-US")}`
          : null;
      const activeDeals =
        typeof entry.snapshot?.activeDeals === "number"
          ? `${entry.snapshot.activeDeals} active deal(s)`
          : null;
      parts.push([pipelineValue, activeDeals].filter(Boolean).join(" across "));
    }
    if ((entry.snapshot?.staleDeals?.length ?? 0) > 0) {
      parts.push(`${entry.snapshot?.staleDeals?.length ?? 0} stale deal(s)`);
    }
    if ((entry.snapshot?.pendingReplies?.length ?? 0) > 0) {
      parts.push(`${entry.snapshot?.pendingReplies?.length ?? 0} reply item(s)`);
    }
    if (entry.experiments.length > 0) {
      parts.push(`${entry.experiments.length} experiment(s)`);
    }

    if (parts.length > 0) {
      gtmLines.push(`- [${entry.companyName}] ${parts.join(" | ")}`);
    }
  }

  lines.push("GTM:");
  if (gtmLines.length === 0) {
    lines.push("- No notable GTM changes this morning.");
  } else {
    lines.push(...gtmLines);
  }
  lines.push("");

  // Content Engine section (for configured blog sites)
  const cfg = resolveConductorConfig(api);
  const blogLines = await buildBlogSection(cfg.blogConfig);
  if (blogLines.length > 0) {
    lines.push("Content Engine:");
    lines.push(...blogLines);
    lines.push("");
  }

  const priorities = buildPriorityList(status.entries, gtm.entries);
  lines.push("Priority suggestions:");
  if (priorities.length === 0) {
    lines.push("- No urgent actions suggested.");
  } else {
    priorities.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.companyName}] ${item.text}`);
    });
  }

  return {
    entries: status.entries,
    report: lines.join("\n"),
  };
}

async function readState(statePath: string): Promise<{ lastSentDate?: string }> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as { lastSentDate?: string };
  } catch {
    return {};
  }
}

async function writeState(statePath: string, state: { lastSentDate: string }): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function maybeSendMorningReport(
  api: OpenClawPluginApi,
  stateDir: string,
): Promise<boolean> {
  const cfg = resolveConductorConfig(api);
  if (!cfg.morningReportEnabled) {
    return false;
  }

  const now = new Date();
  const targetHour = cfg.morningReportHourLocal ?? 8;
  if (now.getHours() < targetHour) {
    return false;
  }

  const statePath = path.join(stateDir, "conductor-morning-report.json");
  const state = await readState(statePath);
  const today = localDateKey(now);
  if (state.lastSentDate === today) {
    return false;
  }

  const report = await buildMorningReport(api);
  const sent = await notifyDiscord(api, {
    audience: "private",
    text: report.report,
  });
  if (!sent) {
    return false;
  }

  await writeState(statePath, { lastSentDate: today });
  return true;
}
