import { spawn } from "../environment"
import type { Transport } from "./json-rpc"

/** How much of a process's stderr is kept, to say why it ended. */
const STDERR_TAIL = 2000
/** How many of the last stderr lines an error about a program that ended shows. */
const REPORT_LINES = 5
/** An error about a program that ended shows no more than this many characters of its stderr. */
const REPORT_CHARS = 500
/** How long an error about a program that ended waits for the rest of its stderr. A child it left running may hold stderr open. */
const STDERR_DRAIN_MS = 100
/**
 * How long a program has to exit after SIGTERM before it gets SIGKILL. T3 Code found a Codex app-server that
 * ignores SIGTERM and chose 2 seconds. Without the kill, a closed tab's agent keeps running.
 */
const KILL_AFTER_MS = 2000

/** A program run as a peer: its stdin and stdout carry the messages, and `stderr` holds the end of what it printed there. */
export interface Process extends Transport {
  stderr(): string
  /** Calls `listener` with each line the program prints on stderr from now on, without its newline. */
  onStderrLine(listener: (line: string) => void): void
  /** Resolves with the exit code once the program has ended. */
  readonly exited: Promise<number>
}

/** A program `run` started, which also says how it ended. */
export interface Spawned extends Process {
  /** Resolves once everything the program printed on stderr is in `stderr()`. */
  readonly drained: Promise<void>
  /** The signal that ended the program, such as "SIGKILL", once it has ended by one. */
  signal(): string | null
}

/**
 * Runs a program whose stdin and stdout speak one JSON message per line. `env` replaces variables of the
 * core's environment, and a variable set to undefined is removed.
 */
export function run(command: string[], options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {}): Spawned {
  const child = spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe", ...(options.cwd ? { cwd: options.cwd } : {}), env: options.env as Record<string, string> })
  let tail = ""
  let closing = false
  const listeners: ((line: string) => void)[] = []
  const drained = (async () => {
    for await (const line of lines(child.stderr)) {
      tail = `${tail}${line}\n`.slice(-STDERR_TAIL)
      for (const listener of listeners) listener(line)
    }
  })()
  return {
    lines: lines(child.stdout),
    write: (line) => {
      child.stdin.write(`${line}\n`)
      child.stdin.flush()
    },
    close: () => {
      if (closing) return
      closing = true
      child.kill()
      // Unref'd, so a pending kill never keeps the core from exiting. The check skips a program that has
      // exited, so its pid, which the system may have given to another process, is never signalled.
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }, KILL_AFTER_MS)
      timer.unref()
      void child.exited.then(() => clearTimeout(timer))
    },
    stderr: () => tail.trim(),
    onStderrLine: (listener) => void listeners.push(listener),
    exited: child.exited,
    drained,
    signal: () => (child.signalCode === null ? null : String(child.signalCode)),
  }
}

/**
 * The program, with an end that says why it ended. When the program's output ends, the lines throw
 * an error with how it ended and the last lines it printed on stderr, so every request still waiting
 * fails with that, not with "the process ended". A write to a program that has already ended is dropped,
 * since the program's end reports it. `name` is how the program is called in that error, such as "Codex".
 */
export function explainEnd(program: Spawned, name: string): Process {
  let ended = false
  void program.exited.then(() => (ended = true))
  return {
    ...program,
    lines: (async function* () {
      yield* program.lines
      const code = await program.exited
      await Promise.race([program.drained, Bun.sleep(STDERR_DRAIN_MS)])
      throw new Error(describeEnd(name, code, program.signal(), program.stderr()))
    })(),
    write: (line) => {
      try {
        program.write(line)
      } catch (error) {
        // A program that ended closes its stdin, and a write to it fails with EPIPE.
        if (!ended && (error as { code?: string }).code !== "EPIPE") throw error
      }
    },
  }
}

/** How a program ended, in a sentence, then the end of what it printed on stderr. */
function describeEnd(name: string, code: number, signal: string | null, stderr: string): string {
  const how = signal ? `${name} was ended by ${signal}.` : `${name} exited with code ${code}.`
  const printed = stderrEnd(stderr)
  return printed ? `${how}\n\n${printed}` : how
}

/** The last few lines of stderr, cut to the last characters when they run long. */
function stderrEnd(stderr: string): string {
  const text = stderr.split("\n").slice(-REPORT_LINES).join("\n").trim()
  return text.length > REPORT_CHARS ? `…${text.slice(-REPORT_CHARS)}` : text
}

/** A byte stream as its lines, without their newlines. A last line with no newline is still a line. */
export async function* lines(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    let end: number
    while ((end = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
    }
  }
  if (buffer) yield buffer
}
