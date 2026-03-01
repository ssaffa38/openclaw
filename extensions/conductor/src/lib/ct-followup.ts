import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ConductorTask } from "../types.js";
import { readMessagesDiscord } from "../../../../src/discord/send.js";
import { resolveConductorConfig } from "./config.js";
import { notifyDiscord } from "./notifier.js";

const DEFAULT_CT_ACK_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CT_HISTORY_LIMIT = 25;

function extractChannelId(target: string): string {
  return target.startsWith("channel:") ? target.slice("channel:".length) : target;
}

function hasTaskReference(content: string, taskId: string): boolean {
  return content.toLowerCase().includes(taskId.toLowerCase());
}

export async function refreshCtDelegationTask(
  api: OpenClawPluginApi,
  task: ConductorTask,
): Promise<void> {
  if (task.executor !== "ct" || !task.delegation) {
    return;
  }

  const cfg = resolveConductorConfig(api);
  const ackTimeoutMs = cfg.ctDelegation.ackTimeoutMs ?? DEFAULT_CT_ACK_TIMEOUT_MS;
  const historyLimit = cfg.ctDelegation.historyLimit ?? DEFAULT_CT_HISTORY_LIMIT;
  const channelId = extractChannelId(task.delegation.channelTarget);
  const messages = await readMessagesDiscord(
    channelId,
    { limit: historyLimit },
    { accountId: cfg.ctDelegation.accountId },
  );

  const acknowledgement = messages.find((message) => {
    if (!message.content || !hasTaskReference(message.content, task.id)) {
      return false;
    }
    if (task.delegation?.requestMessageId && message.id === task.delegation.requestMessageId) {
      return false;
    }
    const createdAt = Date.parse(message.timestamp);
    return Number.isFinite(createdAt) ? createdAt >= task.delegation.requestedAt : true;
  });

  if (acknowledgement) {
    task.status = "running";
    task.delegation.acknowledgedAt = Date.parse(acknowledgement.timestamp) || Date.now();
    task.delegation.acknowledgedMessageId = acknowledgement.id;
    task.updatedAt = Date.now();
    return;
  }

  const expired = Date.now() - task.delegation.requestedAt >= ackTimeoutMs;
  if (expired && task.lastNotifiedStatus !== "failed") {
    const sent = await notifyDiscord(api, {
      audience: "private",
      text: `CT delegation ${task.id} has not been acknowledged within ${Math.round(ackTimeoutMs / 60000)} minutes.`,
    });
    if (sent) {
      task.lastNotifiedStatus = "failed";
    }
  }
}
