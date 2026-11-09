import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import { basename, extname, isAbsolute, join, normalize } from "node:path"

/** Image types a browser draws, by extension, with the type the core serves them as. */
const IMAGE_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}
/** File names that usually hold a project's mark. */
const ICON_NAME = /logo|icon|favicon|brand|mark|avatar/i
/** Enough to choose from without listing every icon in an icon set. */
const MAX_FILES = 60
/** An icon is small. A larger file is likely a screenshot or an asset, not a mark. */
const MAX_ICON_BYTES = 1024 * 1024

/**
 * Images in a project that look like its logo, for the icon picker. Git lists the files, so ignored
 * folders such as node_modules stay out. Favicons and logos near the root come first. A file listed
 * but deleted, or too large to be an icon, is left out.
 */
export function findIconFiles(dir: string): string[] {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) return []
  return listed.stdout
    .split("\n")
    .filter((path) => path && ICON_NAME.test(basename(path)))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    // Only what the core will serve, so the picker never shows a broken image.
    .filter((path) => iconFile(dir, path))
    .slice(0, MAX_FILES)
}

/** Lower comes first: favicons and logos before other marks, then shallower paths. */
function rank(path: string) {
  const name = basename(path).toLowerCase()
  const kind = name.startsWith("favicon") ? 0 : name.includes("logo") ? 1 : 2
  return kind * 100 + path.split("/").length
}

/**
 * A project's icon file and its type, for the core to serve. It refuses a path outside the project,
 * a file that is not an image, and a file too large to be an icon.
 */
export function iconFile(dir: string, path: string): { path: string; type: string } | undefined {
  const relative = normalize(path)
  if (isAbsolute(relative) || relative.startsWith("..")) return undefined
  const type = IMAGE_TYPES[extname(relative).toLowerCase()]
  if (!type) return undefined
  const file = join(dir, relative)
  try {
    const stat = statSync(file)
    return stat.isFile() && stat.size <= MAX_ICON_BYTES ? { path: file, type } : undefined
  } catch {
    return undefined
  }
}
