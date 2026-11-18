import { accessSync, constants, mkdirSync } from "node:fs"
import { join } from "node:path"
import { which } from "../../environment"
import { explainEnd, run, type Process } from "../process"
import { isNewer } from "../versions"
import { APP_DATA, EXECUTABLE, geminiHome, installedVersions, runtimeFolder } from "./home"
import { MIN_VERSION } from "./release"
import { BROWSER_COMMAND } from "./sign-in-link"

/**
 * Variables that would sign the agent in some other way than the user's Google account, as T3 Code
 * removes them. BROWSER is replaced by Comet's helper.
 */
const REMOVED = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GCLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
]

/** The `agy` CLI Comet runs, with its version when Comet installed it. */
export interface Runtime {
  readonly command: string
  readonly version?: string
}

/**
 * The `agy` CLI Comet runs: COMET_ANTIGRAVITY when set, by path or by name on the PATH, else the newest
 * one Comet installed. It is not the Antigravity app, which serves no ACP.
 */
export function resolveRuntime(): Runtime | undefined {
  const override = process.env.COMET_ANTIGRAVITY
  if (override) {
    const path = override.includes("/") ? override : which(override)
    return path && executable(path) ? { command: path } : undefined
  }
  const version = installedVersions().find((installed) => !isNewer(MIN_VERSION, installed))
  return version ? { command: join(runtimeFolder(version), EXECUTABLE), version } : undefined
}

/** Whether Comet once installed Google's ACP server, which it no longer runs, and has no CLI in its place. */
export const onlyServerInstalled = () => !resolveRuntime() && installedVersions().some((installed) => isNewer(MIN_VERSION, installed))

function executable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Starts the CLI's ACP server in a folder, signed in through Comet's own Gemini folder. If it ends, the error says how and what it printed on stderr. */
export function launch(runtime: Runtime, dir: string): Process {
  mkdirSync(geminiHome(), { recursive: true, mode: 0o700 })
  return explainEnd(run([runtime.command, "acp", "--gemini-dir", geminiHome(), "--app-data-dir", APP_DATA], { cwd: dir, env: environment() }), "Antigravity")
}

/** The variables the CLI starts with, on top of the core's. A variable set to undefined is removed. */
export function environment(): Record<string, string | undefined> {
  return { ...Object.fromEntries(REMOVED.map((name) => [name, undefined])), BROWSER: BROWSER_COMMAND }
}
