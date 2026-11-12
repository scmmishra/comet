import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, statSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "../../environment"
import { antigravityHome, markInstalled, runtimeFolder } from "./home"
import { RELEASE, RELEASE_PLATFORM, type Release } from "./release"

const UNZIP = "/usr/bin/unzip"
const NOTHING_INSTALLED = "Nothing was installed."

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

async function fetchTo(url: string, path: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`The Antigravity download failed with HTTP ${response.status}. ${NOTHING_INSTALLED}`)
  await Bun.write(path, response)
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
