import type { AgentVersion } from "@desk/protocol"
import { isNewer } from "../versions"

/** A release of Google's `agy` CLI: its version, where its archive is, and the archive's SHA-512. */
export interface Release {
  readonly version: string
  readonly url: string
  readonly sha512: string
}

/** The platform Desk installs Antigravity on. Desk runs only on Macs with Apple silicon. */
export const RELEASE_PLATFORM = "darwin-arm64"

/** Where Google names the newest `agy` CLI for Macs with Apple silicon, as T3 Code reads it. */
const MANIFEST = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json"
const LOOKUP_TIMEOUT_MS = 10_000

/**
 * The oldest release Desk installs or runs from its install. Before 1.5.1 the CLI offers models other
 * than Gemini only to clients it allowlists, such as Zed, as T3 Code found. Releases before 1.5.0 are
 * Google's ACP server, which an earlier Desk installed.
 */
export const MIN_VERSION = "1.5.1"

const VERSION = /^\d+\.\d+\.\d+$/
const SHA512 = /^[a-f0-9]{128}$/i
/** The only place a release's archive may be: Google's bucket, under the release's own version, after T3 Code. */
const archiveUrl = (version: string) => new RegExp(`^https://storage\\.googleapis\\.com/antigravity-public/antigravity-cli/${version.replaceAll(".", "\\.")}-\\d+/darwin-arm/cli_mac_arm64\\.tar\\.gz$`)

/** The release a manifest names, or undefined when it is not one Desk installs. */
export function parseRelease(manifest: unknown): Release | undefined {
  if (typeof manifest !== "object" || manifest === null) return undefined
  const { version, url, sha512 } = manifest as Record<string, unknown>
  if (typeof version !== "string" || typeof url !== "string" || typeof sha512 !== "string") return undefined
  if (!VERSION.test(version) || isNewer(MIN_VERSION, version) || !archiveUrl(version).test(url) || !SHA512.test(sha512)) return undefined
  return { version, url, sha512: sha512.toLowerCase() }
}

interface LookupOptions {
  /** Aborts when the user stops what waits for the lookup. */
  readonly signal?: AbortSignal
  /** A test's, in place of the network. */
  readonly fetcher?: (url: string, init: RequestInit) => Promise<Response>
}

/** The newest release on Google's channel. It throws a sentence the user reads when Google names none Desk installs. */
export async function latestRelease({ signal, fetcher = fetch }: LookupOptions = {}): Promise<Release> {
  const stopped = AbortSignal.any([AbortSignal.timeout(LOOKUP_TIMEOUT_MS), ...(signal ? [signal] : [])])
  const response = await fetcher(MANIFEST, { signal: stopped }).catch(() => undefined)
  signal?.throwIfAborted()
  const release = response?.ok ? parseRelease(await response.json().catch(() => undefined)) : undefined
  if (!release) throw new Error("Desk could not read the newest Antigravity release from Google. Check the network connection, then try again.")
  return release
}

/** Desk's install of the CLI against the newest release, which Desk updates it to. Without an answer from Google, it says only what is installed. */
export async function checkForUpdate(installed: string, options: LookupOptions = {}): Promise<AgentVersion> {
  const latest = await latestRelease(options).then(
    (release) => release.version,
    () => undefined,
  )
  return { installed, ...(latest ? { latest } : {}), updateAvailable: !!latest && isNewer(latest, installed), updatable: true }
}
