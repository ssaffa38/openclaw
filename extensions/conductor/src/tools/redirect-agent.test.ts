import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConductorConfig = vi.fn();
const getTask = vi.fn();
const upsertTask = vi.fn();
const sendMessageToSession = vi.fn();
const captureSessionTail = vi.fn();

vi.mock("../lib/config.js", () => ({
  resolveConductorConfig,
}));

vi.mock("../lib/registry.js", () => ({
  getTask,
  upsertTask,
}));

vi.mock("../lib/tmux.js", () => ({
  sendMessageToSession,
  captureSessionTail,
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

describe("conductor_redirect_agent", () => {
  beforeEach(() => {
    resolveConductorConfig.mockReset();
    getTask.mockReset();
    upsertTask.mockReset();
    sendMessageToSession.mockReset();
    captureSessionTail.mockReset();

    resolveConductorConfig.mockReturnValue({ tasksPath: "/tmp/active-tasks.json" });
    getTask.mockResolvedValue({
      id: "task-1",
      tmuxSession: "conductor-task-1",
      updatedAt: 1,
      redirects: [],
    });
    upsertTask.mockResolvedValue(undefined);
    sendMessageToSession.mockResolvedValue(undefined);
    captureSessionTail.mockResolvedValue("recent output");
  });

  it("sends a redirect message into the tmux session", async () => {
    const { createRedirectAgentTool } = await import("./redirect-agent.js");
    const tool = createRedirectAgentTool(fakeApi() as never);

    const result = await tool.execute("id", {
      taskId: "task-1",
      message: "Stop. Focus on the button only.",
    });

    expect(sendMessageToSession).toHaveBeenCalledWith({
      sessionName: "conductor-task-1",
      message: "Stop. Focus on the button only.",
    });
    expect(upsertTask).toHaveBeenCalledWith(
      "/tmp/active-tasks.json",
      expect.objectContaining({
        redirects: [
          expect.objectContaining({
            message: "Stop. Focus on the button only.",
          }),
        ],
      }),
    );
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.redirected).toBe(true);
    // oxlint-disable-next-line typescript/no-explicit-any
    expect((result as any).details.redirectCount).toBe(1);
  });
});
