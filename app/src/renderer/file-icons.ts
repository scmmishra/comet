import { chooseIconName } from "@opencode/ui/icons/file-type-name"

/**
 * File-type icons from @opencode/ui. The package does not export its FileIcon component, and file
 * chips are HTML strings, so icons work the way FileIcon works inside: each SVG loads lazily, once,
 * into a hidden sprite, and chips point at it with <use>.
 */
const SOURCES = import.meta.glob<string>("../../node_modules/@opencode/ui/src/assets/icons/file-types/*.svg", {
  query: "?raw",
  import: "default",
})
const FALLBACK = "Document"
const SPRITE_ID = "desk-file-icon-sprite"

// The icon set's names are its file names in PascalCase, as @opencode/ui's sprite generator writes them.
const loaders = new Map(
  Object.entries(SOURCES).map(([path, load]) => [
    path
      .slice(path.lastIndexOf("/") + 1, -".svg".length)
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(""),
    load,
  ]),
)
const requested = new Set<string>()

/** The icon a file gets, such as "Typescript" for a .ts file. */
export function fileIconName(path: string): string {
  const name = chooseIconName(path, "file", false)
  return loaders.has(name) ? name : FALLBACK
}

export const fileIconId = (name: string) => `desk-file-icon-${name}`

/** Adds an icon to the sprite the first time a chip needs it. */
export function requestFileIcon(name: string) {
  if (requested.has(name)) return
  requested.add(name)
  void loaders.get(name)?.().then((svg) => addSymbol(name, svg))
}

function addSymbol(name: string, svg: string) {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement
  const symbol = document.createElementNS("http://www.w3.org/2000/svg", "symbol")
  symbol.id = fileIconId(name)
  symbol.setAttribute("viewBox", parsed.getAttribute("viewBox") ?? "0 0 24 24")
  symbol.append(...Array.from(parsed.childNodes))
  sprite().append(symbol)
}

function sprite(): Element {
  const found = document.getElementById(SPRITE_ID)
  if (found) return found
  const created = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  created.id = SPRITE_ID
  created.setAttribute("aria-hidden", "true")
  created.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden")
  document.body.append(created)
  return created
}
