import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";
import type { ConductorTask } from "../types.js";
import { jsonResult, readStringParam } from "../../../../src/agents/tools/common.js";
import { loadCompanies, resolveCompanyRepo } from "../lib/company-loader.js";
import { resolveConductorConfig } from "../lib/config.js";
import { resolveSpawnModelRoute } from "../lib/model-router.js";
import { notifyDiscord } from "../lib/notifier.js";
import { buildPrompt } from "../lib/prompt-builder.js";
import { readRegistry, upsertTask } from "../lib/registry.js";
import { slugifyTaskId } from "../lib/task-id.js";
import { killSession, spawnClaudeSession } from "../lib/tmux.js";
import { searchVault } from "../lib/vault-reader.js";
import { prepareWorktree, removeWorktree } from "../lib/worktree.js";

export function createSpawnAgentTool(api: OpenClawPluginApi) {
  return {
    name: "conductor_spawn_agent",
    description: "Create a worktree and launch a Conductor-managed Claude Code task.",
    parameters: Type.Object({
      company: Type.String({ description: "Company key from companies.json." }),
      task: Type.String({ description: "Plain-English task description." }),
      repoRole: Type.Optional(
        Type.String({ description: "Repo role when a company has many repos." }),
      ),
      repoPath: Type.Optional(Type.String({ description: "Explicit repo path override." })),
      repoSlug: Type.Optional(
        Type.String({ description: "Explicit owner/name override for gh CLI." }),
      ),
      branchName: Type.Optional(Type.String({ description: "Branch name override." })),
      taskId: Type.Optional(Type.String({ description: "Task ID override." })),
      model: Type.Optional(Type.String({ description: "Claude model override." })),
      modelTier: Type.Optional(Type.Number({ description: "Model tier metadata." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const companyId = readStringParam(params, "company", { required: true });
      const taskDescription = readStringParam(params, "task", { required: true });
      const repoRole = readStringParam(params, "repoRole");
      const repoPathOverride = readStringParam(params, "repoPath");
      const repoSlugOverride = readStringParam(params, "repoSlug");
      const cfg = resolveConductorConfig(api);
      const registry = await readRegistry(cfg.tasksPath);
      const activeCount = registry.tasks.filter((task) => task.status === "running").length;
      if (activeCount >= cfg.maxConcurrentAgents) {
        throw new Error(
          `Max concurrent agents reached (${cfg.maxConcurrentAgents}). Use conductor_list_tasks or conductor_kill_agent first.`,
        );
      }

      const companies = await loadCompanies(cfg.companiesPath);
      const { company, repo } = resolveCompanyRepo({
        companies,
        companyId,
        repoRole,
        repoPath: repoPathOverride,
      });

      const taskId =
        readStringParam(params, "taskId") ?? slugifyTaskId(`${companyId}-${taskDescription}`);
      const branchName =
        readStringParam(params, "branchName") ?? `conductor/${slugifyTaskId(taskDescription)}`;
      const modelRoute = resolveSpawnModelRoute({
        task: taskDescription,
        repo,
        company,
        defaultModel: cfg.defaultModel,
        explicitModel: readStringParam(params, "model"),
        explicitModelTier: typeof params.modelTier === "number" ? params.modelTier : null,
      });
      const model = modelRoute.model;
      const modelTier = modelRoute.tier;
      const sessionName = `conductor-${taskId}`;

      let task: ConductorTask | null = null;
      try {
        const prepared = await prepareWorktree({
          repoPath: repo.path,
          repoSlug: repoSlugOverride,
          branchName,
          taskId,
          worktreeRoot: cfg.worktreeRoot,
          pm: repo.pm,
        });

        let vaultContext: string | undefined;
        if (cfg.vaultPath) {
          const searchTerms = [company.name];
          if (company.keywords?.length) searchTerms.push(...company.keywords);
          vaultContext =
            (await searchVault({
              vaultPath: cfg.vaultPath,
              searchTerms,
              maxTotalChars: cfg.vaultContextMaxChars,
            }).catch(() => null)) ?? undefined;
        }

        const prompt = await buildPrompt({
          companyId,
          company,
          repo,
          task: taskDescription,
          repoPath: repo.path,
          baseBranch: prepared.baseBranch,
          branchName,
          repoSlug: prepared.repoSlug,
          vaultContext,
        });

        task = {
          id: taskId,
          executor: "agent",
          company: companyId,
          repoSlug: prepared.repoSlug,
          repoPath: repo.path,
          baseBranch: prepared.baseBranch,
          branchName,
          tmuxSession: sessionName,
          worktree: prepared.worktreePath,
          modelTier,
          model,
          prompt,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          status: "running",
          retries: 0,
          pr: {
            number: null,
            url: null,
            lastCommitSha: null,
          },
          checks: {
            tmuxAlive: true,
            prCreated: false,
            ciStatus: null,
            reviews: [],
          },
        };

        await spawnClaudeSession({
          sessionName,
          cwd: prepared.worktreePath,
          model,
          prompt,
        });

        await upsertTask(cfg.tasksPath, task);
        await notifyDiscord(api, {
          audience: "private",
          text: `Spawned ${task.id} for ${company.name} on branch ${branchName} using Tier ${modelTier} (${model}).`,
        }).catch(() => undefined);
        return jsonResult({ task });
      } catch (error) {
        if (task) {
          await killSession(task.tmuxSession).catch(() => undefined);
          await removeWorktree({ repoPath: task.repoPath, worktreePath: task.worktree }).catch(
            () => undefined,
          );
        }
        throw error;
      }
    },
  };
}
