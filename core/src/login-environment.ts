import { readFileSync } from "node:fs"
import { join } from "node:path"
import { deskHome, writeJsonFile } from "./data-files"
import { spawn } from "./environment"
import { userShell } from "./shell"

/**
 * What Claude Code sets for the processes it starts. A Desk started from inside a Claude Code session
 * inherits them, and the sessions Desk starts would take themselves for children of that session:
 * Claude Code then stops saving their transcripts, so they cannot be resumed. Rune hit the same issue.
 * Other CLAUDE_ variables, such as CLAUDE_CONFIG_DIR, are the user's own and stay.
 */
const isAgentSessionMarker = (name: string) => name.startsWith("CLAUDE_CODE_") || ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_PLUGIN_DATA"].includes(name)

/**
 * The variables Desk takes from the user's shell, after T3 Code. PATH finds their tools. SSH_AUTH_SOCK
 * reaches the SSH agent they set up, such as 1Password's, for git over SSH. The locale keeps non-ASCII
 * text intact. The certificate variables let tools trust a company proxy.
 */
const NAMES = ["PATH", "SSH_AUTH_SOCK", "LANG", "LC_ALL", "LC_CTYPE", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"] as const
type Captured = Partial<Record<(typeof NAMES)[number], string>>

/**
 * How long each read may take. The interactive shell runs .zshrc, which took up to 1.2 s on one Mac. The
 * cache hides that after the first start. The other reads take milliseconds.
 */
const INTERACTIVE_TIMEOUT_MS = 5_000
const LOGIN_TIMEOUT_MS = 2_000
const LAUNCHCTL_TIMEOUT_MS = 1_000

/** Markers around the environment, so text that .zshrc prints is not read as a variable. */
const START = "__DESK_ENV_START__"
const END = "__DESK_ENV_END__"
const CAPTURE = `printf '%s' ${START}; /usr/bin/env -0; printf '%s' ${END}`

const cachePath = () => join(deskHome(), "shell-environment.json")

/**
 * Sets the environment that everything the core starts runs with. Desk opened from the Dock or Finder
 * starts with launchd's environment, whose PATH lacks Homebrew, mise and ~/.local/bin, so Desk could
 * not find claude, gh or the user's editor. It takes the variables a new terminal has instead.
 *
 * `ready` settles once the environment is in place: at once from the cache, or after the shell answers
 * on the first start. `refreshed` settles once the shell answered and the cache holds its answer.
 */
export function takeLoginEnvironment(interactiveTimeoutMs = INTERACTIVE_TIMEOUT_MS): { ready: Promise<void>; refreshed: Promise<void> } {
  for (const name of Object.keys(process.env)) if (isAgentSessionMarker(name)) delete process.env[name]
  const inherited = { ...process.env }
  const shell = userShell()
  // A cache read under another shell or home would describe someone else's terminal.
  const key = JSON.stringify([shell, process.env.HOME ?? "", process.env.ZDOTDIR ?? ""])
  const cached = readCache(key)
  if (cached) apply(inherited, cached)
  const refreshed = readEnvironment(shell, interactiveTimeoutMs)
    .then(({ environment, fromShell }) => {
      // Without a shell's answer, the cache stays: launchd's PATH would only take tools away.
      if (fromShell || !cached) apply(inherited, environment)
      if (fromShell) writeJsonFile(cachePath(), { key, environment })
    })
    .catch(() => {})
  return { ready: cached ? Promise.resolve() : refreshed, refreshed }
}

/**
 * Asks an interactive login shell first, which reads .zprofile and .zshrc as a terminal does. A shell
 * that fails or hangs is asked again without .zshrc. When neither answers, launchd's PATH is the last resort.
 */
async function readEnvironment(shell: string, interactiveTimeoutMs: number): Promise<{ environment: Captured; fromShell: boolean }> {
  for (const [flags, timeout] of [["-ilc", interactiveTimeoutMs], ["-lc", LOGIN_TIMEOUT_MS]] as const) {
    const output = await read([shell, flags, CAPTURE], timeout, END)
    const environment = output === undefined ? {} : parse(output)
    if (environment.PATH) return { environment, fromShell: true }
  }
  const path = (await read(["/bin/launchctl", "getenv", "PATH"], LAUNCHCTL_TIMEOUT_MS))?.trim()
  return { environment: path ? { PATH: path } : {}, fromShell: false }
}

/**
 * Runs `command` and returns its output, up to `end` when given. It gives undefined when the command
 * cannot start, ends without `end`, or runs past `timeout`. Reading stops at `end`, because a program
 * .zshrc starts in the background can hold the output open long after the shell exits.
 */
async function read(command: string[], timeout: number, end?: string): Promise<string | undefined> {
  let child
  try {
    // Its own process group, so a timeout stops what .zshrc started too.
    child = spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore", detached: true })
  } catch {
    return undefined
  }
  const reader = child.stdout.getReader()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      // The group already exited.
    }
    void reader.cancel()
  }, timeout)
  const decoder = new TextDecoder()
  let text = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return timedOut || end ? undefined : text
      text += decoder.decode(value, { stream: true })
      if (end && text.includes(end)) return text
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    // Closes Desk's end of the output, which a background job may still hold open.
    void reader.cancel()
  }
}

/** The variables Desk takes, from the NUL-separated `env -0` output between the markers. */
function parse(output: string): Captured {
  const from = output.indexOf(START)
  const to = output.lastIndexOf(END)
  if (from < 0 || to < from) return {}
  const environment: Captured = {}
  for (const entry of output.slice(from + START.length, to).split("\0")) {
    const at = entry.indexOf("=")
    const name = entry.slice(0, at) as (typeof NAMES)[number]
    if (at > 0 && NAMES.includes(name)) environment[name] = entry.slice(at + 1)
  }
  return environment
}

/**
 * Sets each variable from what the shell gave, else from what the core inherited. The shell's PATH
 * comes first, and the inherited PATH's other folders follow, so nothing the app was given is lost.
 */
function apply(inherited: Record<string, string | undefined>, environment: Captured) {
  for (const name of NAMES) {
    const value = name === "PATH" ? joinPaths(environment.PATH, inherited.PATH) : environment[name] || inherited[name]
    if (value) process.env[name] = value
    else delete process.env[name]
  }
}

const joinPaths = (...paths: (string | undefined)[]) => [...new Set(paths.flatMap((path) => path?.split(":") ?? []).filter(Boolean))].join(":")

/** The cached environment when it was read under the same shell and home. */
function readCache(key: string): Captured | undefined {
  try {
    const cache = JSON.parse(readFileSync(cachePath(), "utf8")) as { key?: unknown; environment?: Record<string, unknown> }
    if (cache.key !== key || !cache.environment) return undefined
    const environment: Captured = {}
    for (const name of NAMES) if (typeof cache.environment[name] === "string") environment[name] = cache.environment[name]
    return environment.PATH ? environment : undefined
  } catch {
    return undefined
  }
}
