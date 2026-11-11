import { which } from "../../environment"

/** What to tell the user when Desk finds no Codex to run. */
export const NO_CODEX = "Install the Codex CLI so `codex` is on your PATH."

let found: string | undefined

/**
 * The Codex CLI that Desk runs: DESK_CODEX when set, else `codex` on the PATH, which the core takes from
 * the login shell at start. A path once found is kept. A miss is looked up again next time, so installing
 * Codex needs no restart.
 */
export function codexPath(): string | undefined {
  found ??= process.env.DESK_CODEX || which("codex") || undefined
  return found
}
