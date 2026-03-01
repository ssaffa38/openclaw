import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { resolveConductorConfig } from "./config.js";

function normalizeDiscordTarget(target: string | undefined): string | null {
  if (!target) {
    return null;
  }
  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("channel:") || trimmed.startsWith("user:")) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `channel:${trimmed}`;
  }
  return trimmed;
}

export function resolveCtDelegationTarget(api: OpenClawPluginApi): {
  target: string;
  mention?: string;
  accountId?: string;
} {
  const cfg = resolveConductorConfig(api);
  const target = normalizeDiscordTarget(cfg.ctDelegation.channel);
  if (!target) {
    throw new Error("Conductor ctDelegation.channel is not configured");
  }
  const mention = cfg.ctDelegation.mention?.trim() || undefined;
  const accountId = cfg.ctDelegation.accountId?.trim() || undefined;
  return { target, mention, accountId };
}

export async function sendCtDelegation(
  api: OpenClawPluginApi,
  params: { text: string },
): Promise<{ target: string; mention?: string; accountId?: string; messageId?: string }> {
  const resolved = resolveCtDelegationTarget(api);
  const result = await api.runtime.channel.discord.sendMessageDiscord(
    resolved.target,
    params.text,
    {
      accountId: resolved.accountId,
    },
  );
  return {
    ...resolved,
    messageId: typeof result?.messageId === "string" ? result.messageId : undefined,
  };
}
