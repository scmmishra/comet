import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PLUGIN_NAME } from "@comet/protocol"

/** The version of Comet's plugin API, which a plugin's `api` range must allow. */
export const API_VERSION: string = JSON.parse(readFileSync(Bun.resolveSync("@comet/plugin/package.json", import.meta.dir), "utf8")).version

/**
 * What a plugin says about itself, in the `comet` field of its `package.json`. A plugin folder made by
 * hand needs none. A plugin Comet installs must have one, with a name and an API range.
 */
export interface Manifest {
  /** The plugin's name, which names its folder in `~/.comet/plugins` and starts its contributions' ids. */
  readonly name: string
  /** What Settings and the CLI call it. */
  readonly title?: string
  /** The versions of Comet's plugin API it works with, as a semver range, such as `^0.1.0`. */
  readonly api?: string
  /** The package's own version and description. */
  readonly version?: string
  readonly description?: string
}

/** The manifest in `folder`, or undefined when its `package.json` is missing or has no `comet` field. A broken one throws. */
export function readManifest(folder: string): Manifest | undefined {
  const file = join(folder, "package.json")
  if (!existsSync(file)) return undefined
  let saved: { comet?: unknown; version?: unknown; description?: unknown }
  try {
    saved = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error(`${file} is not valid JSON.`)
  }
  if (saved.comet === undefined) return undefined
  const comet = saved.comet as { name?: unknown; title?: unknown; api?: unknown }
  if (typeof comet !== "object" || comet === null) throw new Error(`The comet field in ${file} must be an object.`)
  if (typeof comet.name !== "string" || !PLUGIN_NAME.test(comet.name)) throw new Error(`The comet field in ${file} must have a name of lowercase letters, digits, - and _.`)
  if (comet.title !== undefined && typeof comet.title !== "string") throw new Error(`The comet title in ${file} must be a string.`)
  if (comet.api !== undefined && typeof comet.api !== "string") throw new Error(`The comet api in ${file} must be a semver range, such as "^${API_VERSION}".`)
  return {
    name: comet.name,
    ...(comet.title ? { title: comet.title } : {}),
    ...(comet.api ? { api: comet.api } : {}),
    ...(typeof saved.version === "string" ? { version: saved.version } : {}),
    ...(typeof saved.description === "string" ? { description: saved.description } : {}),
  }
}

/**
 * Checks that the plugin in `folder` can run as `name` on this Comet: its manifest, if it has one, names
 * it `name` and allows this API. A plugin named for one folder would start contributions and thread keys
 * that another name owns.
 */
export function checkPlugin(folder: string, name: string): Manifest | undefined {
  const manifest = readManifest(folder)
  if (!manifest) return undefined
  if (manifest.name !== name) throw new Error(`The plugin in ${folder} is named ${manifest.name}, not ${name}.`)
  if (manifest.api && !Bun.semver.satisfies(API_VERSION, manifest.api)) {
    throw new Error(`${name} needs Comet's plugin API ${manifest.api}, and this Comet has ${API_VERSION}. Update Comet or the plugin.`)
  }
  return manifest
}
