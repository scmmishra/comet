import { afterAll } from "bun:test"
import type { AgentFeature, AgentId, ThreadEvent } from "@desk/protocol"
import type { Agent, AgentHost, AgentSession, SessionOptions } from "./agents/agent"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

/** Waits until `check` passes, or gives up after `ms`. */
export async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(20)
}

/** A temporary folder, removed after the file's tests. */
export function tempFolder(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), `desk-${prefix}-`))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Points Desk's data folder at a temporary one for the file's tests, so they never touch ~/.desk. */
export function useTempHome() {
  process.env.DESK_HOME = tempFolder("home")
}

/** A Git repo whose first commit holds `files`, and a way to run git in it. */
export function gitRepo(files: Record<string, string>) {
  const dir = tempFolder("repo")
  const git = (...args: string[]) => new TextDecoder().decode(Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "ignore" }).stdout).trim()
  git("init", "-q", "-b", "main")
  git("config", "user.email", "desk@example.com")
  git("config", "user.name", "Desk")
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  for (const [path, text] of Object.entries(files)) write(path, text)
  git("add", ".")
  git("commit", "-q", "-m", "init")
  return { dir, git, write }
}

/** One entry of a Claude transcript: a message the user sent, or Claude's text reply. */
export type TranscriptEntry = { readonly user: string } | { readonly assistant: string }

/**
 * A Claude transcript in a new project, kept in a temporary Claude config folder for the file's tests.
 * Each entry follows the one before it. The project's path is resolved, as Claude Code names its folder
 * after the real path. Answers the project, the session, the transcript's file and each entry's uuid.
 */
export function claudeTranscript(entries: readonly TranscriptEntry[]) {
  process.env.CLAUDE_CONFIG_DIR ??= tempFolder("claude")
  const project = realpathSync(tempFolder("sessions"))
  const folder = join(process.env.CLAUDE_CONFIG_DIR, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"))
  mkdirSync(folder, { recursive: true })
  const sessionId = crypto.randomUUID()
  const uuids = entries.map(() => crypto.randomUUID())
  const lines = entries.map((entry, index) => {
    const message = "user" in entry ? { role: "user", content: entry.user } : { role: "assistant", content: [{ type: "text", text: entry.assistant }] }
    const type = "user" in entry ? "user" : "assistant"
    return JSON.stringify({ type, uuid: uuids[index], parentUuid: uuids[index - 1] ?? null, sessionId, cwd: project, timestamp: new Date(Date.now() + index).toISOString(), message })
  })
  const file = join(folder, `${sessionId}.jsonl`)
  writeFileSync(file, `${lines.join("\n")}\n`)
  return { project, sessionId, file, uuids }
}

/** What a fake agent's sessions and threads were asked to do, in order, such as "send hello" or "rename s1 New name". */
export type FakeCalls = string[]

/**
 * An agent that runs no program, for tests of what the core does around agents. Its sessions record what
 * they are asked, start a session called `<id>-session` on the first message, and stay busy until
 * `finish` ends the turn or a stop does. `threads` lists what the agent has saved, and its optional parts are those `features` names.
 */
export function fakeAgent(id: AgentId, features: readonly AgentFeature[] = [], threads: readonly { readonly id: string; readonly title: string; readonly updatedAt: number }[] = []) {
  const calls: FakeCalls = []
  /** Each session opened, in order: what it was opened with, a way to add to its thread, and a way to end its turn. */
  const sessions: { readonly dir: string; readonly options: SessionOptions; emit(event: ThreadEvent): void; finish(): void }[] = []
  const has = (feature: AgentFeature) => features.includes(feature)
  const make = (host: AgentHost): Agent => ({
    id,
    name: `Fake ${id}`,
    features,
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
        steer: (text) => turn("steer", text),
        interrupt: async () => {
          calls.push("interrupt")
          if (!busy) return
          busy = false
          emit({ kind: "item", item: { type: "result", id: `r${calls.length}`, durationMs: 1, isError: false, stopped: true } })
          emit({ kind: "status", busy: false })
        },
        forceStop: () => false,
        configure: async (settings) => void calls.push(`configure ${settings.model}`),
        answerPermission: (requestId, answer) => void calls.push(`permission ${requestId} ${answer}`),
        answerQuestion: (requestId) => void calls.push(`question ${requestId}`),
        stopTasks: async () => {},
        ...(has("restore-files") ? { restoreFiles: async (messageId: string) => void calls.push(`restore ${messageId}`) } : {}),
        close: () => void calls.push("close"),
      }
    },
    threads: {
      list: async () => [...threads],
      history: async (_dir, threadId) => [{ type: "user", id: `${threadId}-u1`, text: `From ${id}` }],
      context: async () => undefined,
      ...(has("rename") ? { rename: async (_dir: string, threadId: string, title: string) => void calls.push(`rename ${threadId} ${title}`) } : {}),
      ...(has("fork") ? { fork: async (_dir: string, threadId: string) => `${threadId}-fork` } : {}),
      ...(has("delete") ? { delete: async (_dir: string, threadId: string) => void calls.push(`delete ${threadId}`) } : {}),
      ...(has("rewind") ? { rewind: async (_dir: string, threadId: string, messageId: string) => (calls.push(`rewind ${threadId} ${messageId}`), { empty: false as const }) } : {}),
    },
    ...(has("sign-in") ? { signIn: async () => void calls.push("signIn") } : {}),
    close: () => void calls.push("closed"),
  })
  return { make, calls, sessions }
}
