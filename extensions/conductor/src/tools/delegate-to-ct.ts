import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ConductorTask } from "../types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { resolveConductorConfig } from "../lib/config.js";
import { resolveCtDelegationTarget, sendCtDelegation } from "../lib/ct-bridge.js";
import { notifyDiscord } from "../lib/notifier.js";
import { getTask, upsertTask } from "../lib/registry.js";
import { slugifyTaskId } from "../lib/task-id.js";

function buildDelegationMessage(params: {
  taskId: string;
  kind: "workspace" | "okr" | "general";
  task: string;
  workspace?: string;
  objective?: string;
  mention?: string;
}): string {
  const lines = [
    `${params.mention ? `${params.mention} ` : ""}Conductor delegation request for CT`,
    `Task ID: ${params.taskId}`,
    `Kind: ${params.kind}`,
    `Task: ${params.task}`,
  ];
  if (params.workspace) {
    lines.push(`Workspace: ${params.workspace}`);
  }
  if (params.objective) {
    lines.push(`Objective: ${params.objective}`);
  }
  lines.push(
    "Instruction: execute this through the C-Tribe workspace/OKR APIs and report back with the outcome.",
  );
  return lines.join("\n");
}

export function createDelegateToCtTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_delegate_to_ct",
    description:
      "Delegate a C-Tribe workspace or OKR task to CT without touching C-Tribe APIs directly.",
    parameters: Type.Object({
      task: Type.String({ description: "Task to send to CT." }),
      kind: Type.Optional(
        Type.Union([Type.Literal("workspace"), Type.Literal("okr"), Type.Literal("general")], {
          description: "Delegation category. Defaults to workspace.",
        }),
      ),
      workspace: Type.Optional(Type.String({ description: "Optional workspace name for CT." })),
      objective: Type.Optional(Type.String({ description: "Optional OKR/objective identifier." })),
      taskId: Type.Optional(Type.String({ description: "Optional Conductor task ID override." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskDescription = readStringParam(params, "task", { required: true });
      const kind =
        params.kind === "okr" || params.kind === "general" || params.kind === "workspace"
          ? params.kind
          : "workspace";
      const workspace = readStringParam(params, "workspace");
      const objective = readStringParam(params, "objective");
      const taskId =
        readStringParam(params, "taskId") ?? slugifyTaskId(`ctribe-ct-${kind}-${taskDescription}`);
      const cfg = resolveConductorConfig(api);

      const existing = await getTask(cfg.tasksPath, taskId);
      if (existing) {
        throw new Error(`Task already exists: ${taskId}`);
      }

      const previewTarget = resolveCtDelegationTarget(api);
      const outboundMessage = buildDelegationMessage({
        taskId,
        kind,
        task: taskDescription,
        workspace: workspace ?? undefined,
        objective: objective ?? undefined,
        mention: previewTarget.mention,
      });

      const { target, mention, messageId } = await sendCtDelegation(api, {
        text: outboundMessage,
      });

      const now = Date.now();
      const task: ConductorTask = {
        id: taskId,
        executor: "ct",
        company: "ctribe",
        repoSlug: "ct/delegated",
        repoPath: "",
        baseBranch: "ct",
        branchName: `ct/${taskId}`,
        tmuxSession: "",
        worktree: "",
        modelTier: 0,
        model: "ct-bot",
        prompt: taskDescription,
        startedAt: now,
        updatedAt: now,
        status: "queued",
        retries: 0,
        pr: {
          number: null,
          url: null,
          lastCommitSha: null,
        },
        checks: {
          tmuxAlive: false,
          prCreated: false,
          ciStatus: null,
          reviews: [],
        },
        delegation: {
          kind,
          channelTarget: target,
          mention,
          workspace: workspace ?? undefined,
          objective: objective ?? undefined,
          message: outboundMessage,
          requestedAt: now,
          requestMessageId: messageId,
        },
      };

      await upsertTask(cfg.tasksPath, task);
      await notifyDiscord(api, {
        audience: "warRoom",
        text: `Delegated ${task.id} to CT for ${kind}${workspace ? ` in ${workspace}` : ""}.`,
      }).catch(() => undefined);

      return jsonResult({
        task,
        delegated: true,
        target,
      });
    },
  };
}
