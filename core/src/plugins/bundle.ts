import { transformAsync } from "@babel/core"
import solid from "babel-preset-solid"
import type { BunPlugin } from "bun"
import { mkdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { instanceHome } from "../data-files"

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

/** Bundles the plugin whose module is at `plugin` into `<name>.js` for a worker, and returns the bundle's path. */
export async function bundlePlugin(name: string, plugin: string): Promise<string> {
  const outdir = join(instanceHome(), "cache", "plugins")
  mkdirSync(outdir, { recursive: true })
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
  })
  if (!result.success) throw new Error(`Desk could not build the plugin ${name}: ${result.logs.map(String).join("\n")}`)
  return join(outdir, basename(result.outputs[0]!.path))
}
