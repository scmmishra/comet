import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import type { CoreReady } from "@desk/protocol"

export interface CoreInfo {
  readonly port: number
  readonly token: string
}

const START_TIMEOUT_MS = 10_000
const STOP_GRACE_MS = 1000

/** The Bun core for one folder. In development it runs from source next to the app. */
export class CoreProcess {
  private constructor(
    private readonly child: ChildProcess,
    readonly info: CoreInfo,
  ) {}

  /** Starts the core and waits for the line that says where it listens. */
  static start(dir: string): Promise<CoreProcess> {
    const token = randomBytes(24).toString("hex")
    const child = spawn(process.env.DESK_BUN ?? "bun", ["core/src/main.ts"], {
      cwd: resolve(app.getAppPath(), ".."),
      env: { ...process.env, DESK_TOKEN: token, DESK_DIR: dir },
      stdio: ["pipe", "pipe", "inherit"],
    })
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("The core did not start in time.")), START_TIMEOUT_MS)
      child.once("exit", (code) => fail(new Error(`The core exited with code ${code}.`)))
      createInterface({ input: child.stdout! }).once("line", (line) => {
        clearTimeout(timer)
        const ready = JSON.parse(line) as CoreReady
        done(new CoreProcess(child, { port: ready.port, token }))
      })
    })
  }

  /** Closing stdin tells the core to exit. The kill is a fallback for a core that hangs. */
  stop() {
    this.child.stdin?.end()
    setTimeout(() => this.child.kill(), STOP_GRACE_MS).unref()
  }
}
