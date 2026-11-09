import type { CommandInfo } from "@desk/protocol"
import { existsSync, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import { Commands } from "./commands"
import { Terminals } from "./terminals"

export interface SpaceEvents {
  terminalOutput(id: string, data: string): void
  terminalExit(id: string, code: number): void
  commandsChanged(project: string, commands: readonly CommandInfo[]): void
}

/**
 * What one project runs for as long as the core runs: its panel terminals and its commands. The core
 * keeps one per project a tab has used, so a project's work keeps running while other tabs show.
 */
export class Space {
  readonly terminals: Terminals
  readonly commands: Commands

  constructor(
    readonly dir: string,
    events: SpaceEvents,
  ) {
    this.terminals = new Terminals(dir, { output: events.terminalOutput, exit: events.terminalExit })
    this.commands = new Commands(dir, (list) => events.commandsChanged(dir, list))
  }

  stop() {
    this.terminals.closeAll()
    this.commands.stopAll()
  }
}

/** The core's spaces, one per project folder, made the first time something asks for one. */
export class Spaces {
  private byDir = new Map<string, Space>()

  constructor(private readonly events: SpaceEvents) {}

  /** The space for a project folder. The folder must be an absolute path to a directory. */
  get(dir: string): Space {
    let space = this.byDir.get(dir)
    if (!space) {
      if (!isProjectFolder(dir)) throw new Error(`Desk cannot open ${dir}: it is not a folder.`)
      space = new Space(dir, this.events)
      this.byDir.set(dir, space)
    }
    return space
  }

  /** The space that runs the terminal with this id, if one does. */
  withTerminal(id: string): Space | undefined {
    return [...this.byDir.values()].find((space) => space.terminals.has(id))
  }

  all() {
    return [...this.byDir.values()]
  }

  stop() {
    for (const space of this.byDir.values()) space.stop()
  }
}

export function isProjectFolder(dir: string) {
  return isAbsolute(dir) && existsSync(dir) && statSync(dir).isDirectory()
}
