/** A file of a release archive, by its name and size. */
export interface ReleaseFile {
  readonly name: string
  readonly bytes: number
}

/**
 * A release of Google's Antigravity ACP server: a zip of the server and the harness it runs, both flat at
 * its top. The hash and the sizes are checked before anything is installed.
 */
export interface Release {
  readonly version: string
  readonly url: string
  readonly sha256: string
  readonly archiveBytes: number
  readonly executable: ReleaseFile
  readonly harness: ReleaseFile
}

/** The platform Desk installs Antigravity on. Desk runs only on Macs with Apple silicon. */
export const RELEASE_PLATFORM = "darwin-arm64"

/** The release Desk installs, as T3 Code pins it. The hash and sizes match the official ACP registry. */
export const RELEASE: Release = {
  version: "1.4.5",
  url: "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.4.5-darwin-arm64.zip",
  sha256: "886fff7767d08994ca39eb02c3d01a7532c7325a94aa33aaf52d52068733284f",
  archiveBytes: 97_923_855,
  executable: { name: "agy_acp_server.par", bytes: 178_915_920 },
  harness: { name: "localharness_external", bytes: 122_957_936 },
}
