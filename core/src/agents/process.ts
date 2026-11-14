import { spawn } from "../environment"
import type { Transport } from "./json-rpc"

/** How much of a process's stderr is kept, to say why it ended. */
const STDERR_TAIL = 2000
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

/**
 * Runs a program whose stdin and stdout speak one JSON message per line. `env` replaces variables of the
 * core's environment, and a variable set to undefined is removed.
 */
export function run(command: string[], options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {}): Process {
  const child = spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe", ...(options.cwd ? { cwd: options.cwd } : {}), env: options.env as Record<string, string> })
  let tail = ""
  let closing = false
  const listeners: ((line: string) => void)[] = []
  void (async () => {
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
  }
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
