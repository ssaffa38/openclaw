import os from "node:os";
import path from "node:path";

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 * Node's `path.join` and `path.resolve` do NOT handle tilde expansion.
 */
export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}
