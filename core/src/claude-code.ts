import { loginShellPath } from "./shell"

/** What to tell the user when Desk finds no Claude Code to run. */
export const NO_CLAUDE_CODE = "Desk runs the Claude Code installed on this Mac, and found no `claude` on your PATH. Install Claude Code, then send again."

let found: string | undefined

/**
 * The Claude Code that Desk runs: DESK_CLAUDE when set, else `claude` on the login shell's PATH. Desk runs
 * the user's own install rather than one bundled with the Agent SDK, as T3 Code does, so the app stays
 * small and Claude Code updates on its own. A path once found is kept. A miss is looked up again next
 * time, so installing Claude Code needs no restart.
 */
export async function claudeCodePath(): Promise<string> {
  found ??= process.env.DESK_CLAUDE || Bun.which("claude", { PATH: await loginShellPath() }) || undefined
  if (!found) throw new Error(NO_CLAUDE_CODE)
  return found
}
