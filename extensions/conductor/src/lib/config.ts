import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ConductorPluginConfig, ResolvedConductorConfig } from "../types.js";

const DEFAULTS: ResolvedConductorConfig = {
  companiesPath: path.join(os.homedir(), ".openclaw", "conductor", "companies.json"),
  tasksPath: path.join(os.homedir(), ".openclaw", "conductor", "active-tasks.json"),
  experimentsPath: path.join(os.homedir(), ".openclaw", "conductor", "experiments.json"),
  gtmSnapshotPath: path.join(os.homedir(), ".openclaw", "conductor", "gtm-snapshot.json"),
  worktreeRoot: path.join(os.homedir(), "agent-worktrees"),
  maxConcurrentAgents: 3,
  maxRetries: 3,
  defaultModel: "claude-sonnet-4-5-20250929",
  reviewers: ["claude", "gemini"],
  monitorIntervalMs: 600_000,
  notifyChannels: {},
  ctDelegation: {},
  vercelScope: undefined,
  morningReportEnabled: false,
  morningReportHourLocal: undefined,
  blogConfig: {},
};

export function resolveConductorConfig(api: OpenClawPluginApi): ResolvedConductorConfig {
  const pluginConfig = (api.pluginConfig ?? {}) as ConductorPluginConfig;
  return {
    companiesPath: pluginConfig.companiesPath
      ? api.resolvePath(pluginConfig.companiesPath)
      : DEFAULTS.companiesPath,
    tasksPath: pluginConfig.tasksPath
      ? api.resolvePath(pluginConfig.tasksPath)
      : DEFAULTS.tasksPath,
    experimentsPath: pluginConfig.experimentsPath
      ? api.resolvePath(pluginConfig.experimentsPath)
      : DEFAULTS.experimentsPath,
    gtmSnapshotPath: pluginConfig.gtmSnapshotPath
      ? api.resolvePath(pluginConfig.gtmSnapshotPath)
      : DEFAULTS.gtmSnapshotPath,
    worktreeRoot: pluginConfig.worktreeRoot
      ? api.resolvePath(pluginConfig.worktreeRoot)
      : DEFAULTS.worktreeRoot,
    maxConcurrentAgents:
      typeof pluginConfig.maxConcurrentAgents === "number"
        ? pluginConfig.maxConcurrentAgents
        : DEFAULTS.maxConcurrentAgents,
    maxRetries:
      typeof pluginConfig.maxRetries === "number" ? pluginConfig.maxRetries : DEFAULTS.maxRetries,
    defaultModel:
      typeof pluginConfig.defaultModel === "string" && pluginConfig.defaultModel.trim()
        ? pluginConfig.defaultModel.trim()
        : DEFAULTS.defaultModel,
    reviewers:
      Array.isArray(pluginConfig.reviewers) &&
      pluginConfig.reviewers.every((v) => typeof v === "string")
        ? pluginConfig.reviewers
        : DEFAULTS.reviewers,
    monitorIntervalMs:
      typeof pluginConfig.monitorIntervalMs === "number"
        ? pluginConfig.monitorIntervalMs
        : DEFAULTS.monitorIntervalMs,
    notifyChannels: pluginConfig.notifyChannels ?? DEFAULTS.notifyChannels,
    ctDelegation: pluginConfig.ctDelegation ?? DEFAULTS.ctDelegation,
    vercelScope:
      typeof pluginConfig.vercelScope === "string" && pluginConfig.vercelScope.trim()
        ? pluginConfig.vercelScope.trim()
        : DEFAULTS.vercelScope,
    morningReportEnabled: pluginConfig.morningReportEnabled === true,
    morningReportHourLocal:
      typeof pluginConfig.morningReportHourLocal === "number" &&
      pluginConfig.morningReportHourLocal >= 0 &&
      pluginConfig.morningReportHourLocal <= 23
        ? Math.floor(pluginConfig.morningReportHourLocal)
        : DEFAULTS.morningReportHourLocal,
    blogConfig:
      pluginConfig.blogConfig && typeof pluginConfig.blogConfig === "object"
        ? pluginConfig.blogConfig
        : DEFAULTS.blogConfig,
  };
}
