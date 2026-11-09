/**
 * Recognises file paths in a reply, so the thread can show them as file chips.
 * The rules follow T3 Code's `markdownLinks.ts` (MIT, T3 Tools Inc.), trimmed to what Desk needs.
 */

export interface FileReference {
  readonly path: string
  readonly line?: number
  readonly column?: number
}

const POSITION_SUFFIX = /:(\d+)(?::(\d+))?$/
const DISQUALIFIER = /[\s`<>"']/
const PATH_SEPARATOR = /\//
const EXPLICIT_PREFIX = /^(~\/|\.{1,2}\/|\/)/
const ELIDED_SEGMENT = /(?:^|\/)(?:\.{3,}|…)(?:\/|$)/
const FILE_EXTENSION = /\.[A-Za-z0-9_-]+$/
const VERSION_SUFFIX = /\d\.\d[^.]*$/
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
/** A first segment such as `github.com` is a host, not a folder. */
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|dev|app|ai|co|sh|me|gg|so)$/i

/** The file an inline code span or a link target names, or undefined when it is not a file path. */
export function fileReference(text: string): FileReference | undefined {
  const candidate = text.trim()
  if (!candidate || DISQUALIFIER.test(candidate) || URL_SCHEME.test(candidate)) return undefined

  const position = POSITION_SUFFIX.exec(candidate)
  const path = position ? candidate.slice(0, position.index) : candidate
  if (!path || path.endsWith("/") || ELIDED_SEGMENT.test(path)) return undefined
  if (!position && !PATH_SEPARATOR.test(path)) return undefined

  if (!EXPLICIT_PREFIX.test(path)) {
    const first = path.split("/")[0] ?? path
    if (HOSTNAME.test(first)) return undefined
    const name = basename(path)
    if (VERSION_SUFFIX.test(name)) return undefined
    if (!position && !FILE_EXTENSION.test(name)) return undefined
  }

  return {
    path,
    ...(position ? { line: Number(position[1]) } : {}),
    ...(position?.[2] ? { column: Number(position[2]) } : {}),
  }
}

/** "space.ts · L37" — the file name, then the line when there is one. */
export function fileLabel(reference: FileReference) {
  const name = basename(reference.path)
  return reference.line ? `${name} · L${reference.line}` : name
}

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path
}
