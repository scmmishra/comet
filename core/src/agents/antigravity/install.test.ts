import { expect, jest, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import { antigravityHome, EXECUTABLE, isInstalled, markInstalled, runtimeFolder, serverTemp } from "./home"
import { fetchTo, installRuntime } from "./install"
import type { Release } from "./release"

useTempHome()

/** A CLI that prints `printed` as its version. */
const cli = (printed: string) => `#!/bin/sh\necho ${printed}\n`

/** A tar.gz of files by name and text, and the release that names it. */
function release(files: Record<string, string>, version: string): { release: Release; archive: string } {
  const folder = tempFolder("antigravity-tar")
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text, { mode: 0o755 })
  const archive = join(tempFolder("antigravity-archive"), "cli.tar.gz")
  Bun.spawnSync(["/usr/bin/tar", "-czf", archive, "-C", folder, ...Object.keys(files)])
  const sha512 = createHash("sha512").update(readFileSync(archive)).digest("hex")
  return { archive, release: { version, url: "https://example.invalid/cli.tar.gz", sha512 } }
}

const copyFrom = (archive: string) => async (_url: string, path: string) => copyFileSync(archive, path)
const noDownloadLeft = () => !readdirSync(antigravityHome()).some((name) => name.startsWith("download-"))

test("installs the CLI as a program and marks the install finished", async () => {
  // The CLI prints its version only when told not to update itself, so the check runs it the way Comet always does.
  const built = release({ [EXECUTABLE]: `#!/bin/sh\n[ "$AGY_CLI_DISABLE_AUTO_UPDATE" = true ] && echo 9.0.0\n` }, "9.0.0")
  await installRuntime({ release: built.release, download: copyFrom(built.archive) })
  expect(statSync(join(runtimeFolder("9.0.0"), EXECUTABLE)).mode & 0o777).toBe(0o755)
  expect(isInstalled("9.0.0")).toBe(true)
  expect(noDownloadLeft()).toBe(true)
})

test("removes the other installs only once the new one is in place, the ACP server's among them", async () => {
  // What an earlier Comet left: the ACP server's install and the folder it unpacked itself into.
  mkdirSync(runtimeFolder("1.4.5"), { recursive: true })
  writeFileSync(join(runtimeFolder("1.4.5"), "agy_acp_server.par"), "server")
  markInstalled("1.4.5")
  mkdirSync(join(serverTemp(), "run-1"), { recursive: true })
  const update = release({ [EXECUTABLE]: cli("9.1.0") }, "9.1.0")
  await expect(installRuntime({ release: { ...update.release, sha512: "0".repeat(128) }, download: copyFrom(update.archive) })).rejects.toThrow()
  expect(isInstalled("1.4.5")).toBe(true)

  await installRuntime({ release: update.release, download: copyFrom(update.archive) })
  expect(isInstalled("9.1.0")).toBe(true)
  for (const left of [runtimeFolder("1.4.5"), runtimeFolder("9.0.0"), serverTemp()]) expect(existsSync(left)).toBe(false)
})

test("a stopped install keeps the install there was and leaves no download behind", async () => {
  const before = release({ [EXECUTABLE]: cli("9.0.5") }, "9.0.5")
  await installRuntime({ release: before.release, download: copyFrom(before.archive) })
  const stop = new AbortController()
  // The download finishes as the user stops, so the stop lands before the folder is replaced.
  const stopping = async (url: string, path: string, signal: AbortSignal) => {
    await copyFrom(before.archive)(url, path)
    stop.abort()
    signal.throwIfAborted()
  }
  await expect(installRuntime({ release: before.release, download: stopping, signal: stop.signal })).rejects.toThrow()
  expect(isInstalled("9.0.5")).toBe(true)
  expect(noDownloadLeft()).toBe(true)
})

test("refuses a download whose SHA-512 does not match, and keeps the install there was", async () => {
  const built = release({ [EXECUTABLE]: cli("9.0.1") }, "9.0.1")
  await installRuntime({ release: built.release, download: copyFrom(built.archive) })
  const error = await installRuntime({ release: { ...built.release, sha512: "0".repeat(128) }, download: copyFrom(built.archive) }).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download failed its SHA-512 check. Nothing was installed.")
  expect(isInstalled("9.0.1")).toBe(true)
})

test("refuses an archive that holds other files than the CLI", async () => {
  const built = release({ [EXECUTABLE]: cli("9.0.2"), "extra.sh": "rm -rf ~" }, "9.0.2")
  const error = await installRuntime({ release: built.release, download: copyFrom(built.archive) }).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download holds other files than the CLI. Nothing was installed.")
  expect(existsSync(runtimeFolder("9.0.2"))).toBe(false)
})

test("leaves no usable install when the CLI is another version than Google named, or does not start", async () => {
  const other = release({ [EXECUTABLE]: cli("9.0.4") }, "9.0.3")
  const error = await installRuntime({ release: other.release, download: copyFrom(other.archive) }).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download says it is version 9.0.4, not 9.0.3. Nothing was installed.")
  expect(existsSync(runtimeFolder("9.0.3"))).toBe(false)
  const failing = release({ [EXECUTABLE]: "#!/bin/sh\nexit 1\n" }, "9.0.3")
  const failed = await installRuntime({ release: failing.release, download: copyFrom(failing.archive) }).catch((caught: Error) => caught.message)
  expect(failed).toBe("The downloaded Antigravity CLI did not start on this Mac. Nothing was installed.")
  expect(isInstalled("9.0.3")).toBe(false)
})

/** Downloads with `fetcher` in place of the network. */
const fetchWith = (fetcher: (url: string, init: RequestInit) => Promise<Response>) => (url: string, path: string, signal: AbortSignal) => fetchTo(url, path, signal, fetcher)

test("downloads the release with fetch", async () => {
  const built = release({ [EXECUTABLE]: cli("9.0.6") }, "9.0.6")
  await installRuntime({ release: built.release, download: fetchWith(async () => new Response(Bun.file(built.archive))) })
  expect(isInstalled("9.0.6")).toBe(true)
})

test("says in plain words that Google could not be reached, and that nothing was installed", async () => {
  const built = release({ [EXECUTABLE]: cli("9.0.7") }, "9.0.7")
  const unreachable = async () => {
    throw new TypeError("getaddrinfo ENOTFOUND storage.googleapis.com")
  }
  const error = await installRuntime({ release: built.release, download: fetchWith(unreachable) }).catch((caught: Error) => caught.message)
  expect(error).toBe("Comet could not download Antigravity from Google. Check the network connection and any proxy settings, then try again. Nothing was installed.")
  expect(noDownloadLeft()).toBe(true)
})

test("fails a download that stops sending for 60 seconds, and removes what it saved", async () => {
  const built = release({ [EXECUTABLE]: cli("9.0.8") }, "9.0.8")
  // One chunk, then nothing, as a connection that stalls does.
  const stalls = async () => new Response(new ReadableStream({ start: (controller) => controller.enqueue(new Uint8Array([1, 2, 3])) }))
  jest.useFakeTimers()
  let installing: Promise<string>
  let settled = false
  try {
    installing = installRuntime({ release: built.release, download: fetchWith(stalls) }).then(
      () => "installed",
      (caught: Error) => caught.message,
    )
    void installing.finally(() => (settled = true))
    for (let i = 0; i < 50; i++) await Promise.resolve()
    jest.advanceTimersByTime(59_999)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(settled).toBe(false)
    jest.advanceTimersByTime(1)
  } finally {
    jest.useRealTimers()
  }
  expect(await installing).toBe("The Antigravity download stopped: no data came from Google for 60 seconds. Check the network connection, then try again. Nothing was installed.")
  expect(noDownloadLeft()).toBe(true)
})
