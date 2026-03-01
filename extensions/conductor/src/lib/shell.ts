import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    const details = error as Error & { stdout?: string; stderr?: string };
    const parts = [details.message];
    if (details.stderr?.trim()) {
      parts.push(details.stderr.trim());
    }
    throw new Error(parts.join("\n"), { cause: error });
  }
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand("which", [command]);
    return true;
  } catch {
    return false;
  }
}
