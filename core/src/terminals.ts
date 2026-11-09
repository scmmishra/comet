import type { Subprocess } from "bun"
import { loginShell } from "./shell"

/** Output kept per terminal, so a terminal the page draws again shows what it showed before. */
const MAX_BUFFER_CHARS = 256 * 1024

interface Running {
  readonly process: Subprocess
  buffer: string
}

/** Shell sessions, each on its own PTY under an id the app chose. They live as long as the core, not the page. */
export class Terminals {
  private running = new Map<string, Running>()

  constructor(
    private readonly events: {
      output(id: string, data: string): void
      exit(id: string, code: number): void
    },
  ) {}

  /** Starts a terminal in `dir`, or replays the output of one already running under this id. */
  open(id: string, dir: string, cols: number, rows: number) {
    const existing = this.running.get(id)
    if (existing) {
      this.resize(id, cols, rows)
      if (existing.buffer) this.events.output(id, existing.buffer)
      return
    }
    const decoder = new TextDecoder()
    const entry: Running = {
      buffer: "",
      process: Bun.spawn(loginShell(), {
        cwd: dir,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Desk" },
        terminal: {
          cols,
          rows,
          // `stream` keeps a character split across two reads whole.
          data: (_, bytes) => this.receive(id, decoder.decode(bytes, { stream: true })),
          exit: () => {
            this.running.delete(id)
            this.events.exit(id, entry.process.exitCode ?? 0)
          },
        },
      }),
    }
    this.running.set(id, entry)
  }

  input(id: string, data: string) {
    this.running.get(id)?.process.terminal?.write(data)
  }

  /** A hidden terminal measures 0 by 0, which a PTY cannot take. */
  resize(id: string, cols: number, rows: number) {
    if (cols > 0 && rows > 0) this.running.get(id)?.process.terminal?.resize(cols, rows)
  }

  /** Closes every terminal not in `ids`. */
  retain(ids: ReadonlySet<string>) {
    for (const [id, entry] of [...this.running]) {
      if (ids.has(id)) continue
      this.running.delete(id)
      entry.process.terminal?.close()
      entry.process.kill()
    }
  }

  closeAll() {
    this.retain(new Set())
  }

  private receive(id: string, data: string) {
    const entry = this.running.get(id)
    if (!entry || !data) return
    entry.buffer = (entry.buffer + data).slice(-MAX_BUFFER_CHARS)
    this.events.output(id, data)
  }
}
