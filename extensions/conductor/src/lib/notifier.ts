import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import { resolveConductorConfig } from "./config.js";

function normalizeDiscordTarget(target: string | undefined): string | null {
  if (!target) {
    return null;
  }
  const trimmed = target.trim();
  if (!trimmed || trimmed === "DM") {
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

export async function notifyDiscord(
  api: OpenClawPluginApi,
  params: {
    audience: "warRoom" | "private";
    text: string;
  },
): Promise<boolean> {
  const cfg = resolveConductorConfig(api);
  const target = normalizeDiscordTarget(cfg.notifyChannels[params.audience]);
  if (!target) {
    return false;
  }
  await api.runtime.channel.discord.sendMessageDiscord(target, params.text);
  return true;
}
