import { afterAll } from "bun:test"
import type { AgentFeature, AgentId, QueuedMessage, ThreadEvent } from "@comet/protocol"
import type { Agent, AgentHost, AgentSession, Rewound, SessionOptions } from "./agents/agent"
import type { Transport } from "./agents/json-rpc"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

/** Waits until `check` passes, or gives up after `ms`. */
export async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(20)
}

/** A temporary folder, removed after the file's tests. */
export function tempFolder(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), `comet-${prefix}-`))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Points Comet's data folder at a temporary one for the file's tests, so they never touch ~/.comet. */
export function useTempHome() {
  process.env.COMET_HOME = tempFolder("home")
}

/** A Git repo whose first commit holds `files`, and a way to run git in it. */
export function gitRepo(files: Record<string, string>) {
  const dir = tempFolder("repo")
  const git = (...args: string[]) => new TextDecoder().decode(Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "ignore" }).stdout).trim()
  git("init", "-q", "-b", "main")
  git("config", "user.email", "comet@example.com")
  git("config", "user.name", "Comet")
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  for (const [path, text] of Object.entries(files)) write(path, text)
  git("add", ".")
  git("commit", "-q", "-m", "init")
  return { dir, git, write }
}

/**
 * A transport in memory, for a test that plays the peer. `write` gets each line the client writes.
 * `say` sends the client a message, as JSON or as a raw line. `hangUp` ends the lines, as a peer whose
 * process ends does. Closing the transport hangs up too.
 */
export function memoryTransport(write: (line: string) => void) {
  const queue: string[] = []
  let wake: (() => void) | undefined
  let closed = false
  const say = (message: object | string) => {
    queue.push(typeof message === "string" ? message : JSON.stringify(message))
    wake?.()
  }
  const hangUp = () => {
    closed = true
    wake?.()
  }
  const transport: Transport = {
    lines: (async function* () {
      while (true) {
        while (queue.length) yield queue.shift()!
        if (closed) return
        await new Promise<void>((resolve) => (wake = resolve))
      }
    })(),
    write,
    close: hangUp,
  }
  return { transport, say, hangUp }
}

/** What a fake agent's sessions and threads were asked to do, in order, such as "send hello" or "rename s1 New name". */
type FakeCalls = string[]

/**
 * An agent that runs no program, for tests of what the core does around agents. Its sessions record what
 * they are asked, start a session called `<id>-session` on the first message, and stay busy until
 * `finish` ends the turn or a stop does. `threads` lists what the agent has saved, and its optional parts are those `features` names.
 * `movesThreads` says whether its threads can move into worktrees.
 */
export function fakeAgent(id: AgentId, features: readonly AgentFeature[] = [], threads: readonly { readonly id: string; readonly title: string; readonly updatedAt: number }[] = [], movesThreads = false) {
  const calls: FakeCalls = []
  /** Each session opened, in order: what it was opened with, a way to add to its thread, and a way to end its turn. */
  const sessions: { readonly dir: string; readonly options: SessionOptions; emit(event: ThreadEvent): void; finish(): void }[] = []
  const has = (feature: AgentFeature) => features.includes(feature)
  const make = (host: AgentHost): Agent => ({
    id,
    name: `Fake ${id}`,
    features,
    ...(movesThreads ? { movesThreads } : {}),
    inspect: async () => host.publish({ state: "ready", models: [{ value: "default", label: "Default", description: "", efforts: [], fast: false, permissionModes: ["default"] }] }),
    refreshUsage: async () => host.publish({ usage: { windows: [{ id: "week", label: "This week", percent: 10 }] } }),
    open(dir, emit, options): AgentSession {
      let busy = false
      const turn = (verb: string, text: string) => {
        calls.push(`${verb} ${text}`)
        if (!busy) options.onSessionId(options.resume ?? `${id}-session`)
        busy = true
        emit({ kind: "item", item: { type: "user", id: `u${calls.length}`, text } })
        emit({ kind: "status", busy: true })
      }
      sessions.push({
        dir,
        options,
        emit,
        finish() {
          busy = false
          emit({ kind: "item", item: { type: "result", id: `r${calls.length}`, durationMs: 1, isError: false } })
          emit({ kind: "status", busy: false })
        },
      })
      return {
        get busy() {
          return busy
        },
        send: (text) => turn("send", text),
        ...(has("steer") ? { steer: (text: string) => turn("steer", text) } : {}),
        interrupt: async () => {
          calls.push("interrupt")
          if (!busy) return
          busy = false
          emit({ kind: "item", item: { type: "result", id: `r${calls.length}`, durationMs: 1, isError: false, stopped: true } })
          emit({ kind: "status", busy: false })
        },
        // A Force stop ends the turn as stopped, and hands back the messages the test says it never read.
        forceStop: () => {
          if (!busy) return false
          calls.push("forceStop")
          busy = false
          emit({ kind: "item", item: { type: "result", id: `r${calls.length}`, durationMs: 1, isError: false, stopped: true } })
          if (fake.unsent.length) options.onUnsent?.(fake.unsent)
          emit({ kind: "status", busy: false })
          return true
        },
        configure: async (settings) => void calls.push(`configure ${settings.model}`),
        answerPermission: (requestId, answer) => void calls.push(`permission ${requestId} ${answer}`),
        answerQuestion: (requestId) => void calls.push(`question ${requestId}`),
        ...(has("restore-files") ? { restoreFiles: async (messageId: string) => void calls.push(`restore ${messageId}`) } : {}),
        close: () => void calls.push("close"),
      }
    },
    threads: {
      list: async () => [...threads],
      history: async (_dir, threadId) => [{ type: "user", id: `${threadId}-u1`, text: `From ${id}` }],
      context: async () => undefined,
      ...(has("rename") ? { rename: async (_dir: string, threadId: string, title: string) => void calls.push(`rename ${threadId} ${title}`) } : {}),
      ...(has("fork")
        ? {
            fork: async (_dir: string, threadId: string, copy: { readonly messageId?: string }) => {
              calls.push(["fork", threadId, copy.messageId].filter(Boolean).join(" "))
              return `${threadId}-fork`
            },
          }
        : {}),
      ...(has("delete") ? { delete: async (_dir: string, threadId: string) => void calls.push(`delete ${threadId}`) } : {}),
      ...(has("rewind") ? { rewind: async (_dir: string, threadId: string, messageId: string) => (calls.push(`rewind ${threadId} ${messageId}`), fake.rewound) } : {}),
    },
    ...(has("sign-in") ? { signIn: async () => void calls.push("signIn") } : {}),
    close: () => void calls.push("closed"),
  })
  /** `rewound` is what a rewind answers, and `unsent` what a Force stop hands back. A test sets them for the case it checks. */
  const fake: { make: typeof make; calls: FakeCalls; sessions: typeof sessions; rewound: Rewound; unsent: QueuedMessage[] } = { make, calls, sessions, rewound: { empty: false }, unsent: [] }
  return fake
}
