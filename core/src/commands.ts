import type { CommandInfo, CommandProcess, CommandRun, SpaceCommand } from "@desk/protocol"
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { projectDataPath, writeJsonFile } from "./data-files"
import { loginShell } from "./shell"

const IDLE: CommandRun = { state: "idle" }
/** The exit code a shell gives a command it cannot start. */
const CANNOT_START = 127

const commandsPath = (dir: string) => projectDataPath("commands", dir)

/**
 * A project's saved commands, such as a dev server, and their runs. A command runs in the background
 * in the project's folder, with its output discarded. Runs last as long as the core.
 */
export class Commands {
  private saved: SpaceCommand[]
  private runs = new Map<string, CommandRun>()
  private processes = new Map<string, ChildProcess>()

  constructor(
    private readonly dir: string,
    /** Called after any change to the list or to a run. */
    private readonly changed: (commands: readonly CommandInfo[]) => void,
  ) {
    this.saved = loadCommands(dir)
  }

  list(): CommandInfo[] {
    return this.saved.map((command) => ({ ...command, run: this.runs.get(command.id) ?? IDLE }))
  }

  /**
   * Replaces the commands in `replacing` with `processes`, in their place, after Rune's editor. One
   * process saves as a plain command called `name`. Several save as a group called `name`, each under
   * its own name. A process keeps its id, and its run, when it replaces a command with that id.
   */
  save(name: string, processes: readonly CommandProcess[], replacing: readonly string[]) {
    const saved = draftCommands(name, processes, new Set(replacing))
    const kept = new Set(saved.map((command) => command.id))
    const dropped = replacing.filter((id) => !kept.has(id))
    for (const id of dropped) this.forget(id)
    const at = this.saved.findIndex((command) => replacing.includes(command.id))
    const rest = this.saved.filter((command) => !replacing.includes(command.id))
    const index = at < 0 ? rest.length : this.saved.slice(0, at).filter((command) => !replacing.includes(command.id)).length
    this.saved = [...rest.slice(0, index), ...saved, ...rest.slice(index)]
    this.persist()
  }

  /** Removes commands, such as every command in a group, stopping those that run. */
  remove(ids: readonly string[]) {
    for (const id of ids) this.forget(id)
    this.saved = this.saved.filter((command) => !ids.includes(command.id))
    this.persist()
  }

  /** Runs the commands that are not running. */
  run(ids: readonly string[]) {
    for (const id of ids) this.start(id)
  }

  stop(ids: readonly string[]) {
    for (const id of ids) this.end(id)
  }

  private start(id: string) {
    const command = this.saved.find((found) => found.id === id)
    if (!command || this.processes.has(id)) return
    const [shell, ...args] = loginShell(command.command)
    // A process group of its own, so Stop also ends the processes the command starts, such as a dev server's workers.
    const child = spawn(shell!, args, {
      cwd: this.dir,
      env: { ...process.env, DESK_SPACE_ROOT: this.dir },
      stdio: "ignore",
      detached: true,
    })
    this.processes.set(id, child)
    this.setRun(id, { state: "running" })
    child.on("error", () => this.finish(id, child, CANNOT_START))
    child.on("exit", (code, signal) => this.finish(id, child, code ?? (signal ? 1 : 0)))
  }

  private end(id: string) {
    const child = this.processes.get(id)
    if (!child) return
    // Dropped first, so the exit that follows reads as a stop, not a failure.
    this.processes.delete(id)
    this.killGroup(child)
    this.setRun(id, IDLE)
  }

  /** Stops a command and drops its run, for a command about to go. */
  private forget(id: string) {
    this.end(id)
    this.runs.delete(id)
  }

  stopAll() {
    this.stop([...this.processes.keys()])
  }

  private finish(id: string, child: ChildProcess, code: number) {
    if (this.processes.get(id) !== child) return
    this.processes.delete(id)
    this.setRun(id, code === 0 ? { state: "exited" } : { state: "failed", code })
  }

  private killGroup(child: ChildProcess) {
    if (!child.pid) return
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      // The group is already gone.
    }
  }

  private setRun(id: string, run: CommandRun) {
    this.runs.set(id, run)
    this.changed(this.list())
  }

  private persist() {
    writeJsonFile(commandsPath(this.dir), this.saved)
    this.changed(this.list())
  }
}

/** The commands a draft saves as, trimmed and checked. A process keeps its id only if it replaces that command. */
function draftCommands(name: string, processes: readonly CommandProcess[], replacing: ReadonlySet<string>): SpaceCommand[] {
  const title = name.trim()
  if (!title) throw new Error("Enter a name.")
  if (!processes.length) throw new Error("Add a process.")
  const grouped = processes.length > 1
  const names = new Set<string>()
  return processes.map((process) => {
    const command = process.command.trim()
    const own = grouped ? process.name.trim() : title
    if (!command) throw new Error("Enter a command for every process.")
    if (!own) throw new Error("Name every process.")
    if (names.has(own)) throw new Error(`Two processes are named ${own}.`)
    names.add(own)
    const id = process.id && replacing.has(process.id) ? process.id : crypto.randomUUID()
    return grouped ? { id, name: own, command, group: title } : { id, name: own, command }
  })
}

function loadCommands(dir: string): SpaceCommand[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(commandsPath(dir), "utf8"))
    return Array.isArray(parsed) ? parsed.filter(isCommand) : []
  } catch {
    return []
  }
}

const isCommand = (value: unknown): value is SpaceCommand =>
  typeof value === "object" && value !== null && ["id", "name", "command"].every((key) => typeof (value as Record<string, unknown>)[key] === "string")
