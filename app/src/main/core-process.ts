import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import type { CoreReady } from "@desk/protocol"
import type { CoreInfo } from "../shared/bridge"

const START_TIMEOUT_MS = 10_000
const STOP_GRACE_MS = 1000

/**
 * How to start the core. A packaged Desk carries the core's source, its packages and a Bun binary in
 * its resources. A dev Desk runs the core from the repo with `bun` from PATH, and keeps its window
 * apart from the installed Desk's.
 */
function coreCommand() {
  if (app.isPackaged) return { bun: join(process.resourcesPath, "bun"), cwd: join(process.resourcesPath, "core"), env: {} }
  return { bun: process.env.DESK_BUN ?? "bun", cwd: resolve(app.getAppPath(), ".."), env: { DESK_INSTANCE: "dev" } }
}

/** The Bun core, which serves every project. */
export class CoreProcess {
  private constructor(
    private readonly child: ChildProcess,
    readonly info: CoreInfo,
  ) {}

  /** Starts the core and waits for the line that says where it listens. */
  static start(): Promise<CoreProcess> {
    const token = randomBytes(24).toString("hex")
    const { bun, cwd, env } = coreCommand()
    const child = spawn(bun, ["core/src/main.ts"], {
      cwd,
      env: { ...process.env, ...env, DESK_TOKEN: token },
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
