import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const getTask = vi.fn();
const upsertTask = vi.fn();
const sendCtDelegation = vi.fn();
const resolveCtDelegationTarget = vi.fn();
const notifyDiscord = vi.fn();

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/registry.js", () => ({
  getTask,
  upsertTask,
}));

vi.mock("../lib/ct-bridge.js", () => ({
  sendCtDelegation,
  resolveCtDelegationTarget,
}));

vi.mock("../lib/notifier.js", () => ({
  notifyDiscord,
}));

function fakeApi() {
  return {
    id: "conductor",
    name: "conductor",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    resolvePath(input: string) {
      return input;
    },
  };
}

describe("conductor_delegate_to_ct", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    getTask.mockReset();
    upsertTask.mockReset();
    sendCtDelegation.mockReset();
    resolveCtDelegationTarget.mockReset();
    notifyDiscord.mockReset();

    resolveConductorConfig.mockReturnValue({
      tasksPath: "/tmp/active-tasks.json",
    });
    getTask.mockResolvedValue(null);
    upsertTask.mockResolvedValue(undefined);
    resolveCtDelegationTarget.mockReturnValue({ target: "channel:123", mention: "<@ct-bot>" });
    sendCtDelegation.mockResolvedValue({
      target: "channel:123",
      mention: "<@ct-bot>",
      messageId: "discord-msg-1",
    });
    notifyDiscord.mockResolvedValue(true);
  });

  it("delegates a C-Tribe workspace task to CT and persists the handoff", async () => {
    const { createDelegateToCtTool } = await import("./delegate-to-ct.js");
    const tool = createDelegateToCtTool(fakeApi() as never);

    const result = await tool.execute("id", {
      task: "Create a task for the BTI speaker page",
      kind: "workspace",
      workspace: "events",
      taskId: "ct-bti-speaker-page",
    });

    expect(sendCtDelegation).toHaveBeenCalled();
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/active-tasks.json",
      expect.objectContaining({
        id: "ct-bti-speaker-page",
        executor: "ct",
        company: "ctribe",
        status: "queued",
        delegation: expect.objectContaining({
          kind: "workspace",
          workspace: "events",
          channelTarget: "channel:123",
          requestMessageId: "discord-msg-1",
        }),
      }),
    );
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.delegated).toBe(true);
  });

  it("rejects duplicate task ids", async () => {
    getTask.mockResolvedValueOnce({ id: "ct-bti-speaker-page" });

    const { createDelegateToCtTool } = await import("./delegate-to-ct.js");
    const tool = createDelegateToCtTool(fakeApi() as never);

    await expect(
      tool.execute("id", {
        task: "Create a task for the BTI speaker page",
        taskId: "ct-bti-speaker-page",
      }),
    ).rejects.toThrow(/already exists/i);
  });
});
