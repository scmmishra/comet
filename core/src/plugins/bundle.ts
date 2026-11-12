import type { BunPlugin } from "bun"
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { instanceHome, writeJsonFile } from "../data-files"

const SOLID = dirname(Bun.resolveSync("solid-js/package.json", import.meta.dir))
const PLUGIN_PACKAGE = dirname(Bun.resolveSync("@desk/plugin/package.json", import.meta.dir))
const pluginExports = (await Bun.file(join(PLUGIN_PACKAGE, "package.json")).json()).exports as Record<string, string>
/** Packages a plugin imports, which a plugin folder outside Desk cannot resolve on its own. Solid's are its browser builds. */
const PACKAGES: Record<string, string> = {
  "solid-js": join(SOLID, "dist/solid.js"),
  "solid-js/store": join(SOLID, "store/dist/store.js"),
  "solid-js/universal": join(SOLID, "universal/dist/universal.js"),
  ...Object.fromEntries(Object.entries(pluginExports).map(([path, file]) => [join("@desk/plugin", path), join(PLUGIN_PACKAGE, file)])),
}

/**
 * Builds a plugin into one file a worker can load. Solid's JSX compiles against Desk's UI renderer,
 * not the DOM, so the plugin builds data the app draws. The bundle takes Solid's browser build: under
 * Bun, `solid-js` resolves to its server build, which has no reactivity, and the plugin, Solid and the
 * renderer must share one copy of it.
 */
const solidJsx: BunPlugin = {
  name: "desk-solid-jsx",
  setup(build) {
    build.onResolve({ filter: /^(solid-js|@desk\/plugin)/ }, (args) => (PACKAGES[args.path] ? { path: PACKAGES[args.path] } : undefined))
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      // Babel takes about 100 ms to import. A launch that reuses every plugin's bundle never needs it.
      const [{ transformAsync }, { default: solid }] = await Promise.all([import("@babel/core"), import("babel-preset-solid")])
      const result = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        presets: [[solid, { generate: "universal", moduleName: "@desk/plugin/renderer" }]],
      })
      return { contents: result?.code ?? "", loader: "ts" }
    })
  },
}

/**
 * What a bundle was built from and what it wrote: the plugin's module, the Bun that built it, each file the
 * build read, with its size and when it last changed, and each file it wrote. Desk's own files count among
 * those read, such as this one and the renderer, so a new Desk builds again.
 */
interface Built {
  readonly plugin: string
  readonly bun: string
  readonly read: Readonly<Record<string, { readonly size: number; readonly mtimeMs: number }>>
  readonly wrote: readonly string[]
}

/**
 * Bundles the plugin whose module is at `plugin` into `<name>.js` for a worker, and returns the bundle's path.
 * A bundle whose files have not changed since it was built is used again, so a launch builds nothing.
 */
export async function bundlePlugin(name: string, plugin: string): Promise<string> {
  const outdir = join(instanceHome(), "cache", "plugins")
  mkdirSync(outdir, { recursive: true })
  const builtFile = join(outdir, `${name}.built.json`)
  const bundle = join(outdir, `${name}.js`)
  if (isCurrent(builtFile, plugin)) return bundle
  // The bundle starts from a small module that hands the plugin to the host, so both share one renderer.
  const entry = join(outdir, `${name}.entry.ts`)
  await Bun.write(entry, `import { startHost } from "@desk/plugin/host"\nimport plugin from ${JSON.stringify(plugin)}\nstartHost(plugin)\n`)
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    naming: `${name}.js`,
    target: "bun",
    conditions: ["browser"],
    plugins: [solidJsx],
    // A file the plugin imports, such as an SVG for an item's image, is copied beside the bundle. The
    // import names it by its full path, since the app reads it from there.
    publicPath: `${outdir}/`,
    metafile: true,
  })
  if (!result.success) throw new Error(`Desk could not build the plugin ${name}: ${result.logs.map(String).join("\n")}`)
  // The metafile names inputs from the working folder. This file shapes every bundle without being one of them.
  const read = [...Object.keys(result.metafile!.inputs).map((path) => resolve(path)), import.meta.path]
  const wrote = result.outputs.map((output) => output.path)
  writeJsonFile(builtFile, { plugin, bun: Bun.version, read: Object.fromEntries(read.map((path) => [path, stamp(path)])), wrote } satisfies Built)
  return bundle
}

/** Whether the bundle `builtFile` describes was built from `plugin`, by this Bun, from files that have not changed since. */
function isCurrent(builtFile: string, plugin: string): boolean {
  let built: Built
  try {
    built = JSON.parse(readFileSync(builtFile, "utf8")) as Built
  } catch {
    return false
  }
  if (built.plugin !== plugin || built.bun !== Bun.version || !built.wrote.every(existsSync)) return false
  return Object.entries(built.read).every(([path, was]) => {
    try {
      const now = stamp(path)
      return now.size === was.size && now.mtimeMs === was.mtimeMs
    } catch {
      return false
    }
  })
}

function stamp(path: string) {
  const { size, mtimeMs } = statSync(path)
  return { size, mtimeMs }
}
