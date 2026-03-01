import { commandExists, runCommand } from "./shell.js";

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function ensureTmuxAvailable(): Promise<void> {
  if (!(await commandExists("tmux"))) {
    throw new Error("tmux is not installed or not on PATH");
  }
}

export async function hasSession(sessionName: string): Promise<boolean> {
  try {
    await runCommand("tmux", ["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

export async function killSession(sessionName: string): Promise<void> {
  if (await hasSession(sessionName)) {
    await runCommand("tmux", ["kill-session", "-t", sessionName]);
  }
}

export async function sendMessageToSession(params: {
  sessionName: string;
  message: string;
}): Promise<void> {
  await ensureTmuxAvailable();
  if (!(await hasSession(params.sessionName))) {
    throw new Error(`tmux session not found: ${params.sessionName}`);
  }
  await runCommand("tmux", ["send-keys", "-t", params.sessionName, "-l", params.message]);
  await runCommand("tmux", ["send-keys", "-t", params.sessionName, "Enter"]);
}

export async function captureSessionTail(params: {
  sessionName: string;
  lines?: number;
}): Promise<string> {
  await ensureTmuxAvailable();
  const result = await runCommand("tmux", [
    "capture-pane",
    "-p",
    "-t",
    params.sessionName,
    "-S",
    `-${params.lines ?? 40}`,
  ]);
  return result.stdout.trimEnd();
}

export async function spawnClaudeSession(params: {
  sessionName: string;
  cwd: string;
  model: string;
  prompt: string;
}): Promise<void> {
  await ensureTmuxAvailable();
  const command = [
    "claude",
    "--model",
    quotePosixArg(params.model),
    "--dangerously-skip-permissions",
    "-p",
    quotePosixArg(params.prompt),
  ].join(" ");

  await runCommand("tmux", [
    "new-session",
    "-d",
    "-s",
    params.sessionName,
    "-c",
    params.cwd,
    command,
  ]);
}
