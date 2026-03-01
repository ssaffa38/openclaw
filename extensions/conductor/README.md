# Conductor

Conductor is the OpenClaw extension that spawns and monitors coding agents across multiple repos, then layers in lightweight portfolio reporting.

## Phase 1 Status

Implemented:

- Task registry with canonical task schema
- Company registry loading
- Worktree creation and cleanup
- tmux-based Claude Code spawning
- Task tools: spawn, list, check, kill, cleanup, redirect-agent, review-pr, merge-pr
- Background monitor service for PR discovery, CI checks, and notification routing
- Prompt builder with `CLAUDE.md` / `AGENTS.md` injection
- CT delegation bridge for C-Tribe workspace / OKR requests
- Model-tier routing for spawn requests (Tier 1-4 heuristic with current-runtime fallback)
- Redirect history persistence for mid-task course corrections

Not implemented yet:

- HubSpot/Apollo write sync

## Setup

Run:

```bash
extensions/conductor/scripts/setup.sh
```

This creates:

- `~/.openclaw/conductor/companies.json`
- `~/.openclaw/conductor/active-tasks.json`
- `~/.openclaw/conductor/experiments.json`
- `~/.openclaw/conductor/gtm-snapshot.json`
- `~/agent-worktrees/`

Then enable/configure the plugin in OpenClaw and set:

- `plugins.entries.conductor.enabled: true`
- `plugins.entries.conductor.config.notifyChannels.warRoom`
- `plugins.entries.conductor.config.notifyChannels.private`

## Why The Monitor Uses A Service

Conductor currently runs its monitor as a plugin service interval, not as a Gateway cron job.

Reason:

- Gateway cron jobs in OpenClaw are built to schedule agent turns or system events.
- The Conductor monitor is neither of those. It is internal plugin maintenance logic.
- Forcing it through cron would mean inventing an awkward wrapper path just to call back into the plugin.

So the current design is:

- Plugin service interval: the monitor runs directly in-process every `monitorIntervalMs`.
- Gateway cron: still available for user-facing reminders, agent turns, and future orchestration jobs.

In simple terms:

- The service is the bot checking its own homework every few minutes.
- Cron is more like an alarm clock that tells the bot to do a brand new task at a certain time.

That is why the service is the cleaner Phase 1 choice.

## Tools

- `conductor_spawn_agent`
- `conductor_list_tasks`
- `conductor_check_task`
- `conductor_kill_agent`
- `conductor_cleanup`
- `conductor_redirect_agent`
- `conductor_review_pr`
- `conductor_merge_pr`
- `conductor_delegate_to_ct`
- `conductor_scan_work`
- `conductor_company_status`
- `conductor_morning_report`
- `conductor_gtm_report`
- `conductor_update_experiment`

## Model Routing

Spawn requests now route automatically unless you explicitly pass `model` or `modelTier`.

- Tier 1: heavy refactors / architecture work -> `claude-opus-4-5`
- Tier 2: standard feature and bug work -> plugin `defaultModel`
- Tier 3: light maintenance work -> `claude-haiku-4-5-20251001`
- Tier 4: docs / changelog / PR-description style work -> currently falls back to Haiku until a local Ollama runtime is added

## Work Discovery

`conductor_scan_work` currently discovers:

- unassigned GitHub issues
- stale open PRs
- dirty local repos
- Vercel deployment failures and recent error-log activity for repos with `vercelProject` configured

Set `plugins.entries.conductor.config.vercelScope` if your Vercel projects live under a shared team scope.

## Morning Report

Conductor can now generate and optionally auto-send a private morning digest.

- manual tool: `conductor_morning_report`
- scheduled send: set `morningReportEnabled: true`
- optional local send hour: `morningReportHourLocal` (defaults to `8` when enabled)
- digest now includes a lightweight GTM section when local GTM data exists

## GTM Reporting

The current GTM slice is intentionally light and read-only.

- `conductor_gtm_report` reads `experiments.json` for experiment tracking
- `conductor_gtm_report` reads `gtm-snapshot.json` for local pipeline, stale-deal, and reply summaries
- `conductor_update_experiment` creates or updates a record in `experiments.json`
- notifications route to `notifyChannels.private`
- HubSpot, Apollo, and Firestore writes are still deferred

Optional config:

- `experimentsPath`
- `gtmSnapshotPath`

## Sample Company Registry

A starter file lives at:

[`config/companies.json`](/Users/sj/Documents/GitHub/clawdbot-standalone/extensions/conductor/config/companies.json)

Copy it to:

`~/.openclaw/conductor/companies.json`

and then expand it with the real repo set.

Example patterns:

- Shared repo with different business context:
  `ctvs` and `ctv` can both point at `cottontreevc`, but use different `context` and `keywords`.
- Multi-repo company:
  `ctribe` maps web, platform, and bot repos separately so the router can target the right one.
- Single app:
  `sahr-auto` or `cappsule` can map directly to one repo.
