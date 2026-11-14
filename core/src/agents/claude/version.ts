import type { AgentVersion } from "@desk/protocol"
import { readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { configDir } from "./config-dir"
import { claudeCodePath } from "./executable"
import { spawn } from "../../environment"
import { isNewer } from "../versions"

/** Where Anthropic publishes the newest Claude Code version of each update channel, as T3 Code reads it. */
const RELEASES = "https://downloads.claude.ai/claude-code-releases"
const CHANNELS = ["latest", "stable"] as const
const LOOKUP_TIMEOUT_MS = 4000
const VERSION = /\d+\.\d+\.\d+/
/** The native installer keeps each version here, and `claude update` swaps them. */
const NATIVE_VERSIONS = "/.local/share/claude/versions/"

/**
 * Claude Code's version and the newest on its update channel. Claude Code updates itself only while it
 * runs, so Desk checks for it, after T3 Code. A version that cannot be read, such as offline, is left out.
 */
export async function claudeCodeVersion(): Promise<AgentVersion> {
  const path = await claudeCodePath().catch(() => undefined)
  if (!path) return { updateAvailable: false, updatable: false }
  const [installed, latest] = await Promise.all([installedVersion(path), latestVersion()])
  return {
    ...(installed ? { installed } : {}),
    ...(latest ? { latest } : {}),
    updateAvailable: !!installed && !!latest && isNewer(latest, installed),
    updatable: isNativeInstall(path),
  }
}

/** Updates Claude Code with its own updater. Only the native install has one Desk may run. */
export async function updateClaudeCode() {
  const path = await claudeCodePath()
  if (!isNativeInstall(path)) throw new Error("Desk updates only Claude Code's native install. Update this one the way you installed it.")
  const child = spawn([path, "update"], { stdout: "ignore", stderr: "pipe" })
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`Claude Code could not update: ${error.trim() || `exit code ${code}`}`)
}

/** The update channel the user set in Claude Code's settings. Claude Code uses "latest" without one. */
export function updateChannel(settingsFile = join(configDir(), "settings.json")): (typeof CHANNELS)[number] {
  try {
    const channel = (JSON.parse(readFileSync(settingsFile, "utf8")) as { autoUpdatesChannel?: unknown }).autoUpdatesChannel
    return CHANNELS.find((known) => known === channel) ?? "latest"
  } catch {
    return "latest"
  }
}

const isNativeInstall = (path: string) => {
  try {
    return realpathSync(path).includes(NATIVE_VERSIONS)
  } catch {
    return false
  }
}

async function installedVersion(path: string) {
  const child = spawn([path, "--version"], { stdout: "pipe", stderr: "ignore" })
  return VERSION.exec(await new Response(child.stdout).text())?.[0]
}

async function latestVersion() {
  try {
    const response = await fetch(`${RELEASES}/${updateChannel()}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
    const text = response.ok ? (await response.text()).trim() : ""
    return /^\d+\.\d+\.\d+$/.test(text) ? text : undefined
  } catch {
    return undefined
  }
}
