import type { Subprocess } from "bun"

/** Output kept per terminal, so a terminal the page draws again shows what it showed before. */
const MAX_BUFFER_CHARS = 256 * 1024

export interface TerminalEvents {
  output(id: string, data: string): void
  exit(id: string, code: number): void
}

interface Running {
  readonly process: Subprocess
  readonly decoder: TextDecoder
  buffer: string
}

/** Shell sessions in the space, each on its own PTY. They live as long as the core, not the page. */
export class Terminals {
  private running = new Map<string, Running>()

  constructor(
    private readonly dir: string,
    private readonly events: TerminalEvents,
  ) {}

  /** Starts a terminal, or replays the output of one already running under this id. */
  open(id: string, cols: number, rows: number) {
    const existing = this.running.get(id)
    if (existing) {
      existing.process.terminal?.resize(cols, rows)
      if (existing.buffer) this.events.output(id, existing.buffer)
      return
    }
    const shell = process.env.SHELL || "/bin/zsh"
    const decoder = new TextDecoder()
    const entry: Running = {
      decoder,
      buffer: "",
      process: Bun.spawn([shell, "-l"], {
        cwd: this.dir,
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

  resize(id: string, cols: number, rows: number) {
    if (cols > 0 && rows > 0) this.running.get(id)?.process.terminal?.resize(cols, rows)
  }

  private close(id: string) {
    const entry = this.running.get(id)
    if (!entry) return
    this.running.delete(id)
    entry.process.terminal?.close()
    entry.process.kill()
  }

  /** Closes every terminal not in `ids`. The saved tabs list the terminals that should exist. */
  retain(ids: ReadonlySet<string>) {
    for (const id of [...this.running.keys()]) if (!ids.has(id)) this.close(id)
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
