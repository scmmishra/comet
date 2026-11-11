import type { SpawnOptions, Subprocess } from "bun"
import { loginShell } from "./shell"

/**
 * What Claude Code sets for the processes it starts. A Desk started from inside a Claude Code session
 * inherits them, and the sessions Desk starts would take themselves for children of that session:
 * Claude Code then stops saving their transcripts, so they cannot be resumed. Rune hit the same issue.
 * Other CLAUDE_ variables, such as CLAUDE_CONFIG_DIR, are the user's own and stay.
 */
const isAgentSessionMarker = (name: string) => name.startsWith("CLAUDE_CODE_") || ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_PLUGIN_DATA"].includes(name)

/**
 * Sets the environment that everything the core starts runs with. It removes Claude Code's session
 * markers, then takes the login shell's PATH. Desk opened from the Dock or Finder starts with launchd's
 * PATH, which lacks Homebrew, mise and ~/.local/bin, so Desk could not find claude, gh or the user's editor.
 */
export async function takeLoginEnvironment() {
  for (const name of Object.keys(process.env)) if (isAgentSessionMarker(name)) delete process.env[name]
  process.env.PATH = await loginShellPath()
}

/** The login shell's PATH. `zsh -l -c` reads .zprofile but not .zshrc, so a PATH set only in .zshrc is missed. */
async function loginShellPath(): Promise<string> {
  const child = spawn(loginShell('printf %s "$PATH"'), { stdout: "pipe", stderr: "ignore" })
  const path = (await new Response(child.stdout).text()).trim()
  return path || process.env.PATH || ""
}

// Bun copies the environment once, when the process starts. Bun.spawn without `env`, and Bun.which without
// `PATH`, read that copy and miss what `takeLoginEnvironment` set, so the core runs and finds programs only
// through the two functions below. node:child_process, Bun.$ and Workers read process.env when called.

/** Bun.spawn with the core's current environment, plus `options.env`. */
export function spawn<const In extends SpawnOptions.Writable = "ignore", const Out extends SpawnOptions.Readable = "pipe", const Err extends SpawnOptions.Readable = "inherit">(
  command: string[],
  options: SpawnOptions.SpawnOptions<In, Out, Err> = {},
): Subprocess<In, Out, Err> {
  return Bun.spawn(command, { ...options, env: { ...process.env, ...options.env } })
}

/** The path of `command` on the core's current PATH, or null. */
export function which(command: string): string | null {
  return Bun.which(command, { PATH: process.env.PATH ?? "" })
}
