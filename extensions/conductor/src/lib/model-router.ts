import type { CompanyEntry, CompanyRepo } from "../types.js";

export type ModelRoute = {
  tier: number;
  model: string;
  reason: string;
};

const CLAUDE_OPUS_MODEL = "claude-opus-4-5";
const CLAUDE_HAIKU_MODEL = "claude-haiku-4-5-20251001";

const TIER_1_PATTERNS = [
  /\brefactor\b/i,
  /\barchitecture\b/i,
  /\barchitect\b/i,
  /\bmigrate\b/i,
  /\brewrite\b/i,
  /\boverhaul\b/i,
  /\bredesign\b/i,
  /\bentire\b/i,
  /\bacross\b/i,
  /\bmultiple\b.*\bfiles?\b/i,
];

const TIER_4_PATTERNS = [
  /\bcommit message\b/i,
  /\bpr description\b/i,
  /\bpull request description\b/i,
  /\bchangelog\b/i,
  /\brelease notes?\b/i,
  /\breadme\b/i,
  /\bdocumentation\b/i,
  /\bdocs?\b/i,
  /\btypo\b/i,
  /\bjson transform\b/i,
  /\bsummar(?:y|ize|ise)\b/i,
];

const TIER_3_PATTERNS = [
  /\blint(?:ing)?\b/i,
  /\bformat(?:ting)?\b/i,
  /\bcleanup\b/i,
  /\bsmall edit\b/i,
  /\bsimple edit\b/i,
  /\breview\b/i,
  /\bcomment update\b/i,
  /\bcopy change\b/i,
];

export function resolveSpawnModelRoute(params: {
  task: string;
  repo: CompanyRepo;
  company: CompanyEntry;
  defaultModel: string;
  explicitModel?: string | null;
  explicitModelTier?: number | null;
}): ModelRoute {
  const explicitModel = params.explicitModel?.trim();
  if (explicitModel) {
    return {
      tier: params.explicitModelTier ?? 2,
      model: explicitModel,
      reason: "explicit model override",
    };
  }

  if (typeof params.explicitModelTier === "number") {
    return resolveTierRoute(params.explicitModelTier, params.defaultModel);
  }

  const task = params.task.trim();
  const lower = task.toLowerCase();
  const complexityBoost =
    task.length > 220 ||
    lower.includes("end-to-end") ||
    lower.includes("system") ||
    lower.includes("workflow");

  if (
    TIER_1_PATTERNS.some((pattern) => pattern.test(task)) ||
    (complexityBoost && ["platform", "workspace"].includes(params.repo.role))
  ) {
    return {
      tier: 1,
      model: CLAUDE_OPUS_MODEL,
      reason: "heavy multi-step or architectural task",
    };
  }

  if (TIER_4_PATTERNS.some((pattern) => pattern.test(task))) {
    return {
      tier: 4,
      model: CLAUDE_HAIKU_MODEL,
      reason:
        "tier 4 task routed to the lightest available coding model until local runtime exists",
    };
  }

  if (
    TIER_3_PATTERNS.some((pattern) => pattern.test(task)) ||
    (task.length < 90 && /\b(rename|comment|copy|text|docs?)\b/i.test(task))
  ) {
    return {
      tier: 3,
      model: CLAUDE_HAIKU_MODEL,
      reason: "lightweight maintenance task",
    };
  }

  return {
    tier: 2,
    model: params.defaultModel,
    reason: `standard task for ${params.company.name} ${params.repo.role} repo`,
  };
}

function resolveTierRoute(tier: number, defaultModel: string): ModelRoute {
  switch (tier) {
    case 1:
      return {
        tier,
        model: CLAUDE_OPUS_MODEL,
        reason: "explicit tier 1 override",
      };
    case 3:
      return {
        tier,
        model: CLAUDE_HAIKU_MODEL,
        reason: "explicit tier 3 override",
      };
    case 4:
      return {
        tier,
        model: CLAUDE_HAIKU_MODEL,
        reason: "explicit tier 4 override using lightweight Claude fallback",
      };
    case 2:
    default:
      return {
        tier: 2,
        model: defaultModel,
        reason: "explicit tier 2 override",
      };
  }
}
