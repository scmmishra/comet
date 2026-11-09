import type { CommandSource } from "@desk/protocol"
import { spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** A broken mise setup must not leave the import menu waiting. */
const MISE_TIMEOUT_MS = 5_000

/** Lockfiles in the order they name a package manager. Without one, scripts run with npm. */
const LOCKFILES: readonly [file: string, manager: string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
]

type Found = CommandSource["commands"][number]

/**
 * Commands the space already defines, for the Commands card to import: each Procfile's processes,
 * mise's tasks and package.json's scripts. A file that is missing or broken adds nothing.
 */
export async function discoverCommands(dir: string): Promise<CommandSource[]> {
  const sources: CommandSource[] = [...procfiles(dir)]
  const mise = await miseTasks(dir)
  if (mise.length) sources.push({ name: "mise", commands: mise })
  const scripts = packageScripts(dir)
  if (scripts.length) sources.push({ name: "package.json", commands: scripts })
  return sources
}

function procfiles(dir: string): CommandSource[] {
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => file === "Procfile" || file.startsWith("Procfile.")).sort()
  } catch {
    return []
  }
  return files.flatMap((file) => {
    const commands = parseProcfile(read(join(dir, file)) ?? "")
    return commands.length ? [{ name: file, commands }] : []
  })
}

/** `name: command` per line, as foreman reads it. Comments and blank lines are skipped. */
export function parseProcfile(text: string): Found[] {
  return text.split("\n").flatMap((line) => {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line.trim())
    return match ? [{ name: match[1]!, command: match[2]!.trim() }] : []
  })
}

function packageScripts(dir: string): Found[] {
  const text = read(join(dir, "package.json"))
  if (!text) return []
  let scripts: unknown
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts
  } catch {
    return []
  }
  if (typeof scripts !== "object" || scripts === null) return []
  const manager = LOCKFILES.find(([file]) => existsSync(join(dir, file)))?.[1] ?? "npm"
  return Object.keys(scripts).map((name) => ({ name, command: `${manager} run ${quote(name)}` }))
}

/**
 * Asks mise for the space's own tasks, so tasks defined as files count too. It runs in a login shell,
 * because the core may start without the user's PATH.
 */
function miseTasks(dir: string): Promise<Found[]> {
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/zsh", ["-l", "-c", "mise tasks ls --json --local"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
    let output = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), MISE_TIMEOUT_MS)
    child.stdout.on("data", (chunk) => (output += chunk))
    child.on("error", () => resolve([]))
    child.on("close", () => {
      clearTimeout(timer)
      resolve(parseMiseTasks(output))
    })
  })
}

/** mise's task list, without hidden tasks or names it would read as options. */
export function parseMiseTasks(json: string): Found[] {
  let tasks: unknown
  try {
    tasks = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(tasks)) return []
  return tasks
    .filter((task): task is { name: string } => typeof task?.name === "string" && task.name && !task.name.startsWith("-") && task.hide !== true)
    .map((task) => ({ name: task.name, command: `mise run ${quote(task.name)}` }))
}

/** Quotes a name for the shell when it holds anything but safe characters. */
function quote(value: string) {
  return /^[\w.:/-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}

function read(path: string) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}
