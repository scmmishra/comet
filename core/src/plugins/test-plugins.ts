import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export function installPlugin(name: string, source: string) {
  mkdirSync(join(process.env.DESK_HOME!, "plugins", name), { recursive: true })
  writeFileSync(join(process.env.DESK_HOME!, "plugins", name, "index.tsx"), source)
}

export function turnOn(config: { everywhere?: string[]; projects?: Record<string, string[]> }) {
  writeFileSync(join(process.env.DESK_HOME!, "plugins.json"), JSON.stringify(config))
}
