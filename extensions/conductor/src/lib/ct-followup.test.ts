import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const readMessagesDiscord = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("./config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../../../../src/discord/send.js", () => ({
  readMessagesDiscord,
}));

vi.mock("./notifier.js", () => ({
  notifyDiscord,
}));

describe("refreshCtDelegationTask", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    readMessagesDiscord.mockReset();
    notifyDiscord.mockReset();

    resolveConductorConfig.mockReturnValue({
      ctDelegation: {
        accountId: "ops",
        ackTimeoutMs: 30 * 60 * 1000,
        historyLimit: 25,
      },
    });
    notifyDiscord.mockResolvedValue(true);
  });

  it("marks delegated tasks running when CT acknowledges with the task id", async () => {
    const requestedAt = Date.now() - 5_000;
    readMessagesDiscord.mockResolvedValue([
      {
        id: "msg-self",
        content: "Conductor delegation request for CT\nTask ID: ct-task-1",
        timestamp: new Date(requestedAt).toISOString(),
      },
      {
        id: "msg-ack",
        content: "CT picked up ct-task-1 and is handling it",
        timestamp: new Date(requestedAt + 1_000).toISOString(),
      },
    ]);

    const { refreshCtDelegationTask } = await import("./ct-followup.js");
    const task = {
      id: "ct-task-1",
      executor: "ct",
      status: "queued",
      delegation: {
        channelTarget: "channel:123",
        requestedAt,
        requestMessageId: "msg-self",
      },
    } as never;

    await refreshCtDelegationTask({} as never, task);

    expect(readMessagesDiscord).toHaveBeenCalledWith("123", { limit: 25 }, { accountId: "ops" });
    expect(task.status).toBe("running");
    expect(task.delegation.acknowledgedMessageId).toBe("msg-ack");
  });

  it("alerts once when CT does not acknowledge in time", async () => {
    const requestedAt = Date.now() - 31 * 60 * 1000;
    readMessagesDiscord.mockResolvedValue([]);

    const { refreshCtDelegationTask } = await import("./ct-followup.js");
    const task = {
      id: "ct-task-2",
      executor: "ct",
      status: "queued",
      delegation: {
        channelTarget: "channel:123",
        requestedAt,
      },
    } as never;

    await refreshCtDelegationTask({} as never, task);

    expect(notifyDiscord).toHaveBeenCalled();
    expect(task.lastNotifiedStatus).toBe("failed");
  });
});
