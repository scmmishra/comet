import { existsSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cometHome, instanceHome } from "../../data-files"
import { isNewer } from "../versions"

/** The file an install writes last. A folder without it is never run. */
const INSTALLED_MARKER = ".installed"
const VERSION = /^\d+\.\d+\.\d+$/

/** The `agy` CLI's program, as Google's archive names it. */
export const EXECUTABLE = "antigravity"

/** Where Comet keeps Antigravity's files: its installs, its sign-in, its threads and its models. */
export const antigravityHome = () => join(cometHome(), "agents", "antigravity")

/** The folder a version is installed in. */
export const runtimeFolder = (version: string) => join(antigravityHome(), version)

/** Marks a version's folder as installed. */
export const markInstalled = (version: string) => writeFileSync(join(runtimeFolder(version), INSTALLED_MARKER), "")

/** Whether a version's install finished. */
export const isInstalled = (version: string) => existsSync(join(runtimeFolder(version), INSTALLED_MARKER))

/** Every version whose folder Antigravity's home holds, finished or not. */
export function versionFolders(): string[] {
  try {
    return readdirSync(antigravityHome()).filter((name) => VERSION.test(name))
  } catch {
    return []
  }
}

/** The versions whose install finished, newest first. */
export const installedVersions = () =>
  versionFolders()
    .filter(isInstalled)
    .sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))

/**
 * Antigravity's own folder for this Comet, which the CLI takes as `--gemini-dir`. It holds the Google
 * sign-in, so the agent never reads the account, settings or MCP servers of an Antigravity the user runs elsewhere.
 */
export const geminiHome = () => join(antigravityHome(), "home")

/**
 * The CLI's folder, as `--app-data-dir`, which the CLI joins beneath `geminiHome`. Google's ACP server
 * kept its sign-in and conversations there, so those of an install Comet made before the CLI carry over.
 */
export const APP_DATA = "antigravity-acp"

/** The token the agent writes once the user has signed in. */
export const tokenPath = () => join(geminiHome(), APP_DATA, "acp_token.json")

export const threadsFolder = () => join(antigravityHome(), "threads")

/** The models a session last reported, so the picker has them before a session runs. */
export const modelsPath = () => join(antigravityHome(), "models.json")

/** The folder a sign-in runs in. Antigravity adds folders of its own to the folder it works in, so it is not the user's. */
export const signInFolder = () => join(antigravityHome(), "sign-in")

/**
 * Where Google's ACP server, which an earlier Comet ran, unpacked itself, about 1 GB per start. A crash
 * left it behind. The CLI does not unpack, so its install removes the folder.
 */
export const serverTemp = () => join(instanceHome(), "agents", "antigravity", "tmp")
