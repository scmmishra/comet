import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { basename, delimiter, dirname, join } from "node:path"
import { which } from "../../environment"
import { run, type Process } from "../process"
import { geminiHome, INSTALLED_MARKER, runtimeFolder, runtimeTemp } from "./home"
import { RELEASE } from "./release"
import { BROWSER_COMMAND } from "./sign-in-link"

/** The `agy` CLI, from 1.5.0 on, serves ACP itself as `agy acp`, with its harness built in. */
const CLI = /^(agy|antigravity)$/

/**
 * Variables that would sign the agent in some other way than the user's Google account, or point it at
 * another home, as T3 Code removes them. BROWSER is replaced by Desk's helper.
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
  "AGY_ACP_CCPA_PROJECT",
  "AGY_ACP_ENABLE_OAUTH",
]

/** An Antigravity Desk can run: the command that serves ACP, the harness the server needs, and its version when Desk installed it. */
export interface Runtime {
  readonly command: readonly string[]
  /** Absent for the `agy` CLI, which needs none. */
  readonly harness?: string
  readonly version?: string
}

/**
 * The Antigravity Desk runs: DESK_ANTIGRAVITY when set, else the runtime Desk installed, else the ACP
 * server on the PATH with its harness beside it. It is not the Antigravity app, which serves no ACP.
 */
export function resolveRuntime(): Runtime | undefined {
  const override = process.env.DESK_ANTIGRAVITY
  if (override) return external(override.includes("/") ? override : (which(override) ?? ""))
  return installed() ?? onPath()
}

function installed(): Runtime | undefined {
  const folder = runtimeFolder(RELEASE.version)
  const marker = join(folder, INSTALLED_MARKER)
  if (!existsSync(marker)) return undefined
  const { version } = JSON.parse(readFileSync(marker, "utf8")) as { version: string }
  return { command: [join(folder, RELEASE.executable.name)], harness: join(folder, RELEASE.harness.name), version }
}

/** The first server on the PATH that has its harness. A server without one is passed over, as T3 Code does. */
function onPath(): Runtime | undefined {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    const found = folder && external(join(folder, RELEASE.executable.name))
    if (found) return found
  }
  return undefined
}

/** A runtime Desk did not install: the `agy` CLI, or a server with the harness beside its real path. */
function external(path: string): Runtime | undefined {
  if (!executable(path)) return undefined
  if (CLI.test(basename(path))) return { command: [path, "acp"] }
  const real = realpathSync(path)
  const harness = join(dirname(real), RELEASE.harness.name)
  return executable(harness) ? { command: [real], harness } : undefined
}

function executable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Starts the runtime in a folder, signed in through Desk's GEMINI_HOME. Each process unpacks itself into
 * a temporary folder of its own, removed once it ends.
 */
export function launch(runtime: Runtime, dir: string): Process {
  mkdirSync(geminiHome(), { recursive: true, mode: 0o700 })
  mkdirSync(runtimeTemp(), { recursive: true })
  const temp = mkdtempSync(join(runtimeTemp(), "run-"))
  const started = run([...runtime.command], { cwd: dir, env: environment(runtime, temp) })
  void started.exited.then(() => rm(temp, { recursive: true, force: true }))
  return started
}

/** The variables the runtime starts with, on top of the core's. A variable set to undefined is removed. */
export function environment(runtime: Runtime, temp: string): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(REMOVED.map((name) => [name, undefined])),
    GEMINI_HOME: geminiHome(),
    // Keeps the sign-in in a file under GEMINI_HOME rather than in the user's keychain.
    AGY_ACP_FORCE_FILE_STORAGE: "1",
    // Without it, the sign-in link can wait in a buffer while the agent waits for the user.
    PYTHONUNBUFFERED: "1",
    BROWSER: BROWSER_COMMAND,
    TMPDIR: temp,
    ...(runtime.harness ? { ANTIGRAVITY_HARNESS_PATH: runtime.harness } : {}),
  }
}

/** Removes what processes of an earlier run of this Desk left in their temporary folders, such as after a crash. */
export async function clearRuntimeTemp() {
  const folders = await readdir(runtimeTemp()).catch(() => [])
  await Promise.all(folders.map((folder) => rm(join(runtimeTemp(), folder), { recursive: true, force: true })))
}
