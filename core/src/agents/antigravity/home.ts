import { existsSync } from "node:fs"
import { join } from "node:path"
import { deskHome, instanceHome, writeJsonFile } from "../../data-files"

/** The file an install writes last. A folder without it is never run. */
const INSTALLED_MARKER = ".installed"

/** Where Desk keeps Antigravity's files: its runtime, its sign-in, its threads and its models. */
export const antigravityHome = () => join(deskHome(), "agents", "antigravity")

/** The folder a runtime version is installed in. */
export const runtimeFolder = (version: string) => join(antigravityHome(), version)

/** Marks a version's folder as installed. The marker holds the version, because an earlier Desk reads it from there. */
export const markInstalled = (version: string) => writeJsonFile(join(runtimeFolder(version), INSTALLED_MARKER), { version })

/** Whether a version's install finished. */
export const isInstalled = (version: string) => existsSync(join(runtimeFolder(version), INSTALLED_MARKER))

/**
 * Antigravity's own folder for this Desk, as GEMINI_HOME. It holds the Google sign-in, so the agent never
 * reads the account, settings or MCP servers of an Antigravity the user runs elsewhere.
 */
export const geminiHome = () => join(antigravityHome(), "home")

/** The token the agent writes once the user has signed in. */
export const tokenPath = () => join(geminiHome(), "antigravity-acp", "acp_token.json")

export const threadsFolder = () => join(antigravityHome(), "threads")

/** The models a session last reported, so the picker has them before a session runs. */
export const modelsPath = () => join(antigravityHome(), "models.json")

/** The folder a sign-in runs in. Antigravity adds folders of its own to the folder it works in, so it is not the user's. */
export const signInFolder = () => join(antigravityHome(), "sign-in")

/**
 * Where each process unpacks itself, about 1 GB per launch. It is the running Desk's own, so clearing
 * what a Desk left behind never touches what another Desk runs.
 */
export const runtimeTemp = () => join(instanceHome(), "agents", "antigravity", "tmp")
