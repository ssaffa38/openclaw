export type NotifyChannels = {
  warRoom?: string;
  private?: string;
};

export type CtDelegationConfig = {
  channel?: string;
  mention?: string;
  accountId?: string;
  ackTimeoutMs?: number;
  historyLimit?: number;
};

export type BlogSiteConfig = {
  apiBase: string;
  engineApiKey?: string;
  enabled?: boolean;
};

export type BlogConfig = Record<string, BlogSiteConfig>;

export type ConductorPluginConfig = {
  companiesPath?: string;
  tasksPath?: string;
  experimentsPath?: string;
  gtmSnapshotPath?: string;
  worktreeRoot?: string;
  maxConcurrentAgents?: number;
  maxRetries?: number;
  defaultModel?: string;
  reviewers?: string[];
  monitorIntervalMs?: number;
  notifyChannels?: NotifyChannels;
  ctDelegation?: CtDelegationConfig;
  vercelScope?: string;
  morningReportEnabled?: boolean;
  morningReportHourLocal?: number;
  blogConfig?: BlogConfig;
};

export type CompanyRepo = {
  path: string;
  role: string;
  pm?: string | null;
  context?: string;
  integrations?: string[];
  vercelProject?: string;
};

export type CompanyEntry = {
  name: string;
  type: string;
  repos: CompanyRepo[];
  keywords?: string[];
  integrations?: string[];
};

export type CompaniesFile = {
  companies: Record<string, CompanyEntry>;
};

export type ExperimentMetric = {
  baseline?: number;
  current?: number;
  unit?: string;
};

export type ExperimentRecord = {
  id: string;
  company: string;
  hypothesis: string;
  status: "planned" | "running" | "holding" | "completed" | "cancelled";
  startDate?: string;
  nextReview?: string;
  metrics?: Record<string, ExperimentMetric>;
  notes?: string;
};

export type ExperimentsFile = {
  experiments: ExperimentRecord[];
};

export type GtmStaleDeal = {
  name: string;
  stage?: string;
  daysStale: number;
};

export type GtmPendingReply = {
  name: string;
  source?: string;
  summary?: string;
};

export type CompanyGtmSnapshot = {
  pipelineValue?: number;
  activeDeals?: number;
  staleDeals?: GtmStaleDeal[];
  pendingReplies?: GtmPendingReply[];
  notes?: string[];
};

export type GtmSnapshotFile = {
  companies: Record<string, CompanyGtmSnapshot>;
};

export type ReviewResult = {
  reviewer: string;
  verdict: "approve" | "request_changes" | "comment";
  critical: number;
  warnings: number;
  commentId?: number;
  timestamp: number;
};

export type RedirectHistoryEntry = {
  message: string;
  timestamp: number;
};

export type TaskChecks = {
  tmuxAlive: boolean;
  prCreated: boolean;
  ciStatus: "pending" | "passing" | "failing" | null;
  reviews: ReviewResult[];
};

export type TaskStatus =
  | "queued"
  | "running"
  | "pr_open"
  | "reviewing"
  | "ready"
  | "merged"
  | "failed"
  | "cancelled";

export type ConductorTask = {
  id: string;
  executor?: "agent" | "ct";
  company: string;
  repoSlug: string;
  repoPath: string;
  baseBranch: string;
  branchName: string;
  tmuxSession: string;
  worktree: string;
  modelTier: number;
  model: string;
  prompt: string;
  startedAt: number;
  updatedAt?: number;
  lastNotifiedStatus?: TaskStatus | "pr_created";
  status: TaskStatus;
  retries: number;
  pr: {
    number: number | null;
    url: string | null;
    lastCommitSha: string | null;
  };
  checks: TaskChecks;
  redirects?: RedirectHistoryEntry[];
  delegation?: {
    kind: "workspace" | "okr" | "general";
    channelTarget: string;
    mention?: string;
    workspace?: string;
    objective?: string;
    message: string;
    requestedAt: number;
    requestMessageId?: string;
    acknowledgedAt?: number;
    acknowledgedMessageId?: string;
  };
};

export type TaskRegistryFile = {
  tasks: ConductorTask[];
};

export type ResolvedConductorConfig = {
  companiesPath: string;
  tasksPath: string;
  experimentsPath: string;
  gtmSnapshotPath: string;
  worktreeRoot: string;
  maxConcurrentAgents: number;
  maxRetries: number;
  defaultModel: string;
  reviewers: string[];
  monitorIntervalMs: number;
  notifyChannels: NotifyChannels;
  ctDelegation: CtDelegationConfig;
  vercelScope?: string;
  morningReportEnabled: boolean;
  morningReportHourLocal?: number;
  blogConfig: BlogConfig;
};
