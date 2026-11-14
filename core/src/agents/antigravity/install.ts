import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, statSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "../../environment"
import { antigravityHome, markInstalled, runtimeFolder } from "./home"
import { RELEASE, RELEASE_PLATFORM, type Release } from "./release"

const UNZIP = "/usr/bin/unzip"
const NOTHING_INSTALLED = "Nothing was installed."
/** How long the download may go without a byte before it fails. The archive is about 100 MB, so a limit on the whole download would fail a slow link that still works. */
const DOWNLOAD_IDLE_MS = 60_000
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
 * Installs a release of Antigravity's ACP server for Desk: it downloads the archive, checks its size and
 * hash, checks that it holds only the server and its harness, and extracts them. The marker that makes the
 * install usable is written last, so a half-finished install is never run. Once `signal` aborts it stops
 * before it touches the install there was, and leaves that one as it was.
 */
export async function installRuntime({ signal = new AbortController().signal, release = RELEASE, download = fetchTo }: InstallOptions = {}) {
  if (`${process.platform}-${process.arch}` !== RELEASE_PLATFORM) throw new Error("Desk installs Antigravity only on a Mac with Apple silicon.")
  mkdirSync(antigravityHome(), { recursive: true })
  const archive = join(antigravityHome(), `download-${crypto.randomUUID()}.zip`)
  const folder = runtimeFolder(release.version)
  // Set once the folder is replaced, so a failed check before then keeps an install that works.
  let replacing = false
  try {
    await download(release.url, archive, signal)
    const { bytes, sha256 } = await digest(archive)
    if (bytes !== release.archiveBytes || sha256 !== release.sha256) throw new Error(`The Antigravity download failed its size or SHA-256 check. ${NOTHING_INSTALLED}`)
    // Listing first means nothing outside the folder is ever written, whatever names the archive holds.
    const members = (await unzip(["-Z1", archive])).split("\n").filter(Boolean).sort()
    const expected = [release.executable.name, release.harness.name].sort()
    if (members.join("\n") !== expected.join("\n")) throw new Error(`The Antigravity download holds other files than the server and its harness. ${NOTHING_INSTALLED}`)
    // The last moment a stop leaves the install there was untouched.
    signal.throwIfAborted()
    replacing = true
    await rm(folder, { recursive: true, force: true })
    await unzip(["-q", archive, "-d", folder])
    for (const file of [release.executable, release.harness]) {
      const path = join(folder, file.name)
      if (statSync(path).size !== file.bytes) throw new Error(`The Antigravity file ${file.name} has the wrong size. ${NOTHING_INSTALLED}`)
      chmodSync(path, 0o755)
    }
    markInstalled(release.version)
  } catch (error) {
    if (replacing) await rm(folder, { recursive: true, force: true })
    throw error
  } finally {
    await rm(archive, { force: true })
  }
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

/** A file's size and SHA-256, read as a stream, since the archive is about 100 MB. */
async function digest(path: string) {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const chunk of Bun.file(path).stream()) {
    hash.update(chunk)
    bytes += chunk.byteLength
  }
  return { bytes, sha256: hash.digest("hex") }
}

/** Runs unzip, and answers what it printed. */
async function unzip(args: string[]) {
  const child = spawn([UNZIP, ...args], { stdout: "pipe", stderr: "pipe" })
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`Desk could not extract the Antigravity download. ${errors.trim() || NOTHING_INSTALLED}`)
  return output
}
