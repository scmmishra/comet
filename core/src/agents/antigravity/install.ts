import { createHash } from "node:crypto"
import { chmodSync, mkdirSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "../../environment"
import { antigravityHome, EXECUTABLE, markInstalled, runtimeFolder, serverTemp, versionFolders } from "./home"
import { latestRelease, RELEASE_PLATFORM, type Release } from "./release"

const TAR = "/usr/bin/tar"
const NOTHING_INSTALLED = "Nothing was installed."
/** How long the download may go without a byte before it fails. The archive is about 85 MB, so a limit on the whole download would fail a slow link that still works. */
const DOWNLOAD_IDLE_MS = 60_000
/** How long the new CLI has to print its version. It answers in well under a second. */
const VERSION_TIMEOUT_MS = 30_000
const UNREACHABLE = `Desk could not download Antigravity from Google. Check the network connection and any proxy settings, then try again. ${NOTHING_INSTALLED}`
const STALLED = `The Antigravity download stopped: no data came from Google for ${DOWNLOAD_IDLE_MS / 1000} seconds. Check the network connection, then try again. ${NOTHING_INSTALLED}`

/** Saves what `url` serves at `path`. */
type Download = (url: string, path: string, signal: AbortSignal) => Promise<void>

interface InstallOptions {
  /** Aborts when the user stops the install. */
  readonly signal?: AbortSignal
  /** A test installs a release of its own, and downloads it without the network. */
  readonly release?: Release
  readonly download?: Download
}

/**
 * Installs the newest release of Google's `agy` CLI for Desk, after T3 Code: it downloads the archive,
 * checks its SHA-512, checks that it holds only the CLI's program, extracts it, and checks that the
 * program runs and is the release Google named. The marker that makes the install usable is written last,
 * so a half-finished install is never run. Only then does it remove the other installs, such as an
 * earlier version or the ACP server an earlier Desk installed. Once `signal` aborts it stops before it
 * touches an install there was, and leaves that one as it was.
 */
export async function installRuntime({ signal = new AbortController().signal, release, download = fetchTo }: InstallOptions = {}) {
  if (`${process.platform}-${process.arch}` !== RELEASE_PLATFORM) throw new Error("Desk installs Antigravity only on a Mac with Apple silicon.")
  const chosen = release ?? (await latestRelease({ signal }))
  mkdirSync(antigravityHome(), { recursive: true })
  const archive = join(antigravityHome(), `download-${crypto.randomUUID()}.tar.gz`)
  const folder = runtimeFolder(chosen.version)
  // Set once the folder is replaced, so a failed check before then keeps an install that works.
  let replacing = false
  try {
    await download(chosen.url, archive, signal)
    if ((await sha512(archive)) !== chosen.sha512) throw new Error(`The Antigravity download failed its SHA-512 check. ${NOTHING_INSTALLED}`)
    // Listing first means nothing outside the folder is ever written, whatever the archive holds.
    const members = (await tar(["-tvzf", archive])).trim().split("\n")
    const names = (await tar(["-tzf", archive])).trim()
    if (members.length !== 1 || !members[0]!.startsWith("-") || names !== EXECUTABLE) throw new Error(`The Antigravity download holds other files than the CLI. ${NOTHING_INSTALLED}`)
    // The last moment a stop leaves the install there was untouched.
    signal.throwIfAborted()
    replacing = true
    await rm(folder, { recursive: true, force: true })
    mkdirSync(folder, { recursive: true })
    await tar(["-xzf", archive, "-C", folder, EXECUTABLE])
    const program = join(folder, EXECUTABLE)
    chmodSync(program, 0o755)
    const reported = await versionOf(program)
    if (!reported) throw new Error(`The downloaded Antigravity CLI did not start on this Mac. ${NOTHING_INSTALLED}`)
    if (reported !== chosen.version) throw new Error(`The Antigravity download says it is version ${reported}, not ${chosen.version}. ${NOTHING_INSTALLED}`)
    markInstalled(chosen.version)
  } catch (error) {
    if (replacing) await rm(folder, { recursive: true, force: true })
    throw error
  } finally {
    await rm(archive, { force: true })
  }
  // A session that still runs an older version keeps its program, which the system removes once it exits.
  const others = versionFolders().filter((version) => version !== chosen.version)
  await Promise.all([...others.map((version) => rm(runtimeFolder(version), { recursive: true, force: true })), rm(serverTemp(), { recursive: true, force: true })])
}

/**
 * Saves what `url` serves at `path`. It fails once no byte has come for `DOWNLOAD_IDLE_MS`. A network
 * failure says so in plain words, not in fetch's, such as "getaddrinfo ENOTFOUND". `fetcher` is a test's.
 */
export async function fetchTo(url: string, path: string, signal: AbortSignal, fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch) {
  const idle = new AbortController()
  const stopped = AbortSignal.any([signal, idle.signal])
  // A fetch whose body ignores its signal still ends: every wait races the stop.
  const ended = new Promise<never>((_, reject) => stopped.addEventListener("abort", () => reject(stopped.reason), { once: true }))
  ended.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const waitForBytes = () => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(), DOWNLOAD_IDLE_MS)
  }
  const file = Bun.file(path).writer()
  let response: Response | undefined
  try {
    waitForBytes()
    response = await Promise.race([fetcher(url, { signal: stopped }), ended])
    if (!response.ok) throw new Error(`The Antigravity download failed with HTTP ${response.status}. ${NOTHING_INSTALLED}`)
    const reader = response.body?.getReader()
    while (reader) {
      waitForBytes()
      const { done, value } = await Promise.race([reader.read(), ended])
      if (done) break
      file.write(value)
    }
  } catch (error) {
    if (signal.aborted || response?.ok === false) throw error
    throw new Error(idle.signal.aborted ? STALLED : UNREACHABLE, { cause: error })
  } finally {
    clearTimeout(timer)
    await file.end()
  }
}

/** A file's SHA-512, read as a stream, since the archive is about 85 MB. */
async function sha512(path: string) {
  const hash = createHash("sha512")
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk)
  return hash.digest("hex")
}

/** Runs tar, and answers what it printed. */
async function tar(args: string[]) {
  const child = spawn([TAR, ...args], { stdout: "pipe", stderr: "pipe" })
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`Desk could not extract the Antigravity download. ${errors.trim() || NOTHING_INSTALLED}`)
  return output
}

/** The version a program says it is, from `--version`. Empty when it does not run. */
async function versionOf(program: string) {
  try {
    const child = spawn([program, "--version"], { stdout: "pipe", stderr: "ignore", timeout: VERSION_TIMEOUT_MS })
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? output.trim() : ""
  } catch {
    return ""
  }
}
