import type { Skill } from "@desk/protocol"

/** Text typed after a trigger, which the composer offers to complete: `@` lists files, and `/` lists commands. */
export interface Trigger {
  readonly kind: "file" | "command"
  /** Where the trigger character is. */
  readonly start: number
  /** What follows it, up to the caret. */
  readonly query: string
}

/** The trigger the caret is in. A command starts the message. A file mention starts it or follows a space. */
export function triggerAt(text: string, caret: number): Trigger | undefined {
  const before = text.slice(0, caret)
  const command = /^\/(\S*)$/.exec(before)
  if (command) return { kind: "command", start: 0, query: command[1]! }
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before)
  return mention ? { kind: "file", start: caret - mention[1]!.length - 1, query: mention[1]! } : undefined
}

/** `text` with the trigger at `start` replaced by `inserted` and a space, and where the caret goes after it. */
export function complete(text: string, start: number, caret: number, inserted: string): { text: string; caret: number } {
  const after = text.slice(caret).replace(/^\s/, "")
  return { text: text.slice(0, start) + inserted + " " + after, caret: start + inserted.length + 1 }
}

/**
 * The commands that match what was typed after `/`, after T3 Code: names that start with it, then names
 * that hold it, then descriptions that hold it, each in the list's own order. A command whose name an
 * earlier one already took is left out, so Desk's own /model and /clear win over Claude Code's.
 */
export function matchCommands<T extends Pick<Skill, "name" | "description">>(commands: readonly T[], query: string): T[] {
  const wanted = query.toLowerCase()
  const seen = new Set<string>()
  const unique = commands.filter((command) => !seen.has(command.name) && seen.add(command.name))
  const rank = (command: T) => {
    const name = command.name.toLowerCase()
    if (name.startsWith(wanted)) return 0
    if (name.includes(wanted)) return 1
    return command.description.toLowerCase().includes(wanted) ? 2 : undefined
  }
  return unique
    .flatMap((command, index) => {
      const found = rank(command)
      return found === undefined ? [] : [{ command, found, index }]
    })
    .sort((a, b) => a.found - b.found || a.index - b.index)
    .map((match) => match.command)
}
