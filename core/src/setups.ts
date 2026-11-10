import type { SetupInfo } from "@desk/protocol"
import { readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { deskHome } from "./data-files"

const setupsFolder = () => join(deskHome(), "setups")

/** The setups in `~/.desk/setups`, named by their file. A file that is not a whole setup is left out. */
export function loadSetups(): SetupInfo[] {
  let files: string[]
  try {
    files = readdirSync(setupsFolder()).filter((file) => file.endsWith(".json"))
  } catch {
    return []
  }
  return files.flatMap((file) => {
    try {
      const setup = JSON.parse(readFileSync(join(setupsFolder(), file), "utf8")) as Partial<SetupInfo>
      const panels = (value: unknown) => (Array.isArray(value) ? value.filter((panel): panel is string => typeof panel === "string") : [])
      if (typeof setup.name !== "string" || typeof setup.project !== "string") return []
      return [{ id: basename(file, ".json"), name: setup.name, project: setup.project.replace(/^~(?=\/)/, process.env.HOME ?? "~"), layout: { left: panels(setup.layout?.left), panel: panels(setup.layout?.panel) } }]
    } catch {
      return []
    }
  })
}
