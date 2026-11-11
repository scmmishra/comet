import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import { antigravityHome, INSTALLED_MARKER, runtimeFolder } from "./home"
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

test("installs the server and its harness as programs, and writes the marker last", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.0")
  await installRuntime(built.release, copyFrom(built.archive))
  const folder = runtimeFolder("9.0.0")
  expect(readdirSync(folder).sort()).toEqual([INSTALLED_MARKER, "agy_acp_server.par", "localharness_external"])
  expect(statSync(join(folder, "agy_acp_server.par")).mode & 0o777).toBe(0o755)
  expect(JSON.parse(readFileSync(join(folder, INSTALLED_MARKER), "utf8"))).toEqual({ version: "9.0.0" })
  expect(readdirSync(antigravityHome()).some((name) => name.startsWith("download-"))).toBe(false)
})

test("refuses a download whose hash does not match, and keeps the install there was", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.1")
  await installRuntime(built.release, copyFrom(built.archive))
  const error = await installRuntime({ ...built.release, sha256: "0".repeat(64) }, copyFrom(built.archive)).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download failed its size or SHA-256 check. Nothing was installed.")
  expect(existsSync(join(runtimeFolder("9.0.1"), INSTALLED_MARKER))).toBe(true)
})

test("refuses an archive that holds other files than the server and its harness", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness", "extra.sh": "rm -rf ~" }, "9.0.2")
  const error = await installRuntime(built.release, copyFrom(built.archive)).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity download holds other files than the server and its harness. Nothing was installed.")
  expect(existsSync(runtimeFolder("9.0.2"))).toBe(false)
})

test("leaves no usable install when a file has the wrong size", async () => {
  const built = release({ "agy_acp_server.par": "server", localharness_external: "harness" }, "9.0.3")
  const error = await installRuntime({ ...built.release, harness: { name: "localharness_external", bytes: 1 } }, copyFrom(built.archive)).catch((caught: Error) => caught.message)
  expect(error).toBe("The Antigravity file localharness_external has the wrong size. Nothing was installed.")
  expect(existsSync(join(runtimeFolder("9.0.3"), INSTALLED_MARKER))).toBe(false)
})
