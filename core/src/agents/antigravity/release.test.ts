import { expect, test } from "bun:test"
import { checkForUpdate, latestRelease, parseRelease } from "./release"

/** Google's manifest for Macs with Apple silicon, as its channel serves it. */
const MANIFEST = {
  version: "1.5.9",
  url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.9-4515810895593472/darwin-arm/cli_mac_arm64.tar.gz",
  sha512: "A".repeat(128),
}

test("reads Google's manifest, and refuses one that names an old release or an archive elsewhere, after T3 Code", () => {
  expect(parseRelease(MANIFEST)).toEqual({ ...MANIFEST, sha512: "a".repeat(128) })
  const refused = [
    { sha512: "invalid" },
    { version: "1.4.5" },
    { version: "1.5.0", url: MANIFEST.url.replace("1.5.9-", "1.5.0-") },
    { url: MANIFEST.url.replace("https:", "http:") },
    { url: MANIFEST.url.replace("storage.googleapis.com", "storage.googleapis.com.evil.test") },
    { url: MANIFEST.url.replace("antigravity-public", "another-bucket") },
    { url: MANIFEST.url.replace("darwin-arm", "linux-arm") },
    { url: `${MANIFEST.url}?redirect=elsewhere` },
    { url: MANIFEST.url.replace("1.5.9-", "1.5.8-") },
  ]
  expect(refused.map((change) => parseRelease({ ...MANIFEST, ...change }))).toEqual(refused.map(() => undefined))
  expect(parseRelease(null)).toBeUndefined()
})

test("says in plain words when Google's channel names no release Comet installs", async () => {
  const unreachable = async (): Promise<Response> => {
    throw new TypeError("getaddrinfo ENOTFOUND")
  }
  const message = "Comet could not read the newest Antigravity release from Google. Check the network connection, then try again."
  await expect(latestRelease({ fetcher: unreachable })).rejects.toThrow(message)
  await expect(latestRelease({ fetcher: async () => Response.json({ version: "1.4.5" }) })).rejects.toThrow(message)
  expect(await latestRelease({ fetcher: async () => Response.json(MANIFEST) })).toMatchObject({ version: "1.5.9" })
})

test("offers the update once Google names a newer release, and says only what is installed without an answer", async () => {
  const served = async () => Response.json(MANIFEST)
  expect(await checkForUpdate("1.5.8", { fetcher: served })).toEqual({ installed: "1.5.8", latest: "1.5.9", updateAvailable: true, updatable: true })
  expect(await checkForUpdate("1.5.9", { fetcher: served })).toEqual({ installed: "1.5.9", latest: "1.5.9", updateAvailable: false, updatable: true })
  expect(await checkForUpdate("1.5.9", { fetcher: async () => new Response("", { status: 503 }) })).toEqual({ installed: "1.5.9", updateAvailable: false, updatable: true })
})
