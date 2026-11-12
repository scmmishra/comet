import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import { antigravityHome, isInstalled, runtimeFolder } from "./home"
import { installRuntime } from "./install"
import type { Release } from "./release"

useTempHome()

/** A zip of files by name and text, and the release that pins it. */
function release(files: Record<string, string>, version: string): { release: Release; archive: string } {
  const folder = tempFolder("antigravity-zip")
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text)
  const archive = join(folder, "release.zip")
  Bun.spawnSync(["/usr/bin/zip", "-q", archive, ...Object.keys(files)], { cwd: folder })
  const bytes = readFileSync(archive)
  return {
    archive,
    release: {
      version,
      url: "https://example.invalid/release.zip",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      archiveBytes: bytes.length,
      executable: { name: "agy_acp_server.par", bytes: (files["agy_acp_server.par"] ?? "").length },
      harness: { name: "localharness_external", bytes: (files["localharness_external"] ?? "").length },
    },
  }
}

const copyFrom = (archive: string) => async (_url: string, path: string) => copyFileSync(archive, path)

test("installs the server and its harness as programs, and marks the install finished", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.0")
  await installRuntime({ release: built.release, download: copyFrom(built.archive) })
  const folder = runtimeFolder("9.0.0")
  for (const name of ["agy_acp_server.par", "localharness_external"]) expect(statSync(join(folder, name)).mode & 0o777).toBe(0o755)
  expect(isInstalled("9.0.0")).toBe(true)
  expect(readdirSync(antigravityHome()).some((name) => name.startsWith("download-"))).toBe(false)
})

test("a stopped install keeps the install there was and leaves no download behind", async () => {
  const before = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.5")
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
  expect(readdirSync(antigravityHome()).some((name) => name.startsWith("download-"))).toBe(false)
})

test("refuses a download whose hash does not match, and keeps the install there was", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.1")
  await installRuntime({ release: built.release, download: copyFrom(built.archive) })
  const error = await installRuntime({ release: { ...built.release, sha256: "0".repeat(64) }, download: copyFrom(built.archive) }).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download failed its size or SHA-256 check. Nothing was installed.")
  expect(isInstalled("9.0.1")).toBe(true)
})

test("refuses an archive that holds other files than the server and its harness", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness", "extra.sh": "rm -rf ~" }, "9.0.2")
  const error = await installRuntime({ release: built.release, download: copyFrom(built.archive) }).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download holds other files than the server and its harness. Nothing was installed.")
  expect(existsSync(runtimeFolder("9.0.2"))).toBe(false)
})

test("leaves no usable install when a file has the wrong size", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.3")
  const error = await installRuntime({ release: { ...built.release, harness: { name: "localharness_external", bytes: 1 } }, download: copyFrom(built.archive) }).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity file localharness_external has the wrong size. Nothing was installed.")
  expect(isInstalled("9.0.3")).toBe(false)
})
