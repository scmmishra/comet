import { listSessions } from "@anthropic-ai/claude-agent-sdk"
import { expect, test } from "bun:test"
import type { CoreMessage, TabInfo } from "@desk/protocol"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gitRepo, tempFolder, useTempHome } from "./test-support"
import { outcomeAfter, Window } from "./window"

useTempHome()

const tab = (id: string, project: string): TabInfo => ({ id, title: "New session", project, terminals: [], model: "default", permissionMode: "default" })
const saved = () => JSON.parse(readFileSync(join(process.env.DESK_HOME!, "window.json"), "utf8"))

/** A window whose saved file holds `state`, the messages it sends, and each thread a tab moved to. */
function open(state: object) {
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify(state))
  const sent: CoreMessage[] = []
  const shown: [string, string | undefined][] = []
  const window = new Window({
    broadcast: (message) => sent.push(message),
    compactIdle: () => false,
    rateLimit: () => {},
    tabClosed: () => {},
    turnEnded: () => {},
    threadShown: (tabId, threadKey) => shown.push([tabId, threadKey]),
  })
  return { window, sent, shown }
}

test("refuses to move a tab whose thread has started, and moves one that has not", () => {
  const [one, two] = [tempFolder("one"), tempFolder("two")]
  const { window } = open({ tabs: [tab("started", one), tab("fresh", one)], threads: { started: { sessionId: "s1" } }, recent: [] })
  expect(() => window.save([tab("started", two), tab("fresh", one)], "started")).toThrow("only before its thread starts")
  window.save([tab("started", one), tab("fresh", two)], "fresh")
  expect(saved().tabs.map((found: TabInfo) => found.project)).toEqual([one, two])
})

test("drops a closed tab's thread and remembers the folders tabs open, most recent first", () => {
  const [one, two] = [tempFolder("one"), tempFolder("two")]
  const { window, sent } = open({ tabs: [tab("a", one)], threads: { a: { sessionId: "s1" } }, recent: [one] })
  window.save([tab("b", two)], "b")
  expect(saved().threads).toEqual({})
  expect(sent.at(-1)).toEqual({ type: "recent", projects: [two, one] })
})

test("leaves a deleted folder out of the recent list, and lets an older tab in one still save", async () => {
  const one = tempFolder("one")
  const gone = join(one, "gone")
  const { window, sent } = open({ tabs: [tab("a", gone)], threads: {}, recent: [gone, one] })
  window.save([tab("a", gone), tab("b", one)], "b")
  await window.greet((message) => sent.push(message))
  expect(sent.filter((message) => message.type === "recent").at(-1)).toEqual({ type: "recent", projects: [one] })
})

test("refuses a tab that opens a folder that is not there", () => {
  const { window } = open({ tabs: [], threads: {}, recent: [] })
  expect(() => window.save([tab("a", "/no/such/folder")], "a")).toThrow("not a folder")
})

test("reopens the tab closed last, in its place, with its thread and layout, and without its terminals", async () => {
  const [one, gone] = [tempFolder("one"), join(tempFolder("two"), "gone")]
  const kept = { ...tab("b", one), terminals: [{ id: "x1", title: "Terminal" }], panelActive: "x1" }
  const { window } = open({
    tabs: [tab("a", one), kept, tab("c", gone)],
    threads: { b: { threadStart: "abc", key: "conv-1" } },
    layouts: { b: { sidebar: "support.inbox", panels: [], hiddenCards: [] } },
    recent: [],
  })
  window.save([tab("a", one), tab("c", gone)], "a")
  window.save([tab("a", one)], "a")
  expect(saved().threads.b).toBeUndefined()

  const replies: CoreMessage[] = []
  // The tab closed last sits in a folder that is gone, so the one before it comes back.
  await window.reopenTab((message) => replies.push(message))
  expect(replies).toEqual([{ type: "tab.reopened", tab: { ...tab("b", one), terminals: [] }, index: 1 }])
  expect(saved().threads.b).toEqual({ threadStart: "abc", key: "conv-1" })
  expect(saved().layouts.b).toEqual({ sidebar: "support.inbox", panels: [], hiddenCards: [] })
  expect(saved().closed).toEqual([])

  const none: CoreMessage[] = []
  await window.reopenTab((message) => none.push(message))
  expect(none).toEqual([])
})

test("switches a tab's project back to the branch its thread last ran on, and says when it cannot", async () => {
  const repo = gitRepo({ "a.ts": "one\n" })
  repo.git("checkout", "-q", "-b", "feature")
  const { window, sent } = open({ tabs: [tab("a", repo.dir)], threads: { a: { branch: "main" } }, recent: [] })
  expect(await window.restoreBranch("a")).toBe(repo.dir)
  expect(repo.git("branch", "--show-current")).toBe("main")

  // A new thread on the tab has no branch, and the tab hears so.
  window.clearThread("a")
  expect(sent).toContainEqual({ type: "thread.branch", tabId: "a" })
  await expect(window.restoreBranch("a")).rejects.toThrow("no branch")
})

test("keeps a plugin thread's queue with the thread when the tab switches to another key, and brings it back", async () => {
  const project = tempFolder("plugin")
  const queued = { id: "m1", text: "Then check the refund" }
  // A paused queue stays put, so coming back shows it without sending.
  const { window, sent } = open({ tabs: [tab("a", project)], threads: { a: { key: "conv-1", queue: [queued], queueHeld: true } }, recent: [] })

  await window.openKey("a", { key: "conv-2" })
  expect(sent).toContainEqual({ type: "queue", tabId: "a", messages: [], held: false })
  expect(saved().keyed[`${project}\nconv-1`]).toEqual({ key: "conv-1", queue: [queued], queueHeld: true })

  sent.length = 0
  await window.openKey("a", { key: "conv-1" })
  expect(sent).toContainEqual({ type: "queue", tabId: "a", messages: [queued], held: true })
  expect(saved().threads.a).toEqual({ key: "conv-1", queue: [queued], queueHeld: true })
  expect(saved().keyed).toEqual({ [`${project}\nconv-2`]: { key: "conv-2" } })
})

test("tells plugins when a tab moves to another key, and not when it opens the key it shows", async () => {
  const project = tempFolder("plugin")
  const { window, shown } = open({ tabs: [tab("a", project)], threads: { a: { key: "inbox.conv-1" } }, recent: [] })
  expect(window.threadKeyOf("a")).toBe("inbox.conv-1")

  await window.openKey("a", { key: "inbox.conv-1" })
  expect(shown).toEqual([])
  await window.openKey("a", { key: "inbox.conv-2" })
  expect(shown).toEqual([["a", "inbox.conv-2"]])
  expect(window.threadKeyOf("a")).toBe("inbox.conv-2")
})

test("starts a plugin's new thread with its prompt, and leaves a thread it already started alone", async () => {
  const project = tempFolder("plugin-prompt")
  const { window } = open({ tabs: [tab("a", project)], threads: { a: {} }, keyed: { [`${project}\nconv-2`]: { key: "conv-2", sessionId: "s2" } }, recent: [] })
  const said: string[] = []
  window.send = async (_tabId, text) => void said.push(text)
  // History for a started thread cannot be read here, which does not matter to what is sent.
  window["history"] = async () => []
  window["fillContext"] = () => {}

  await window.openKey("a", { key: "conv-1", prompt: "Draft a reply" })
  expect(said).toEqual(["Draft a reply"])

  await window.openKey("a", { key: "conv-2", prompt: "Draft a reply" })
  expect(said).toEqual(["Draft a reply"])
})

test("keeps a closed tab's plugin thread under its key, and gives it back when the tab reopens", async () => {
  const project = tempFolder("plugin-close")
  const { window } = open({ tabs: [tab("a", project), tab("b", project)], threads: { a: { key: "conv-1", sessionId: "s1" } }, recent: [] })
  window.save([tab("b", project)], "b")
  expect(saved().keyed[`${project}\nconv-1`]).toEqual({ key: "conv-1", sessionId: "s1" })
  await window.reopenTab(() => {})
  expect(saved().keyed).toEqual({})
  expect(saved().threads.a).toEqual({ key: "conv-1", sessionId: "s1" })
})

test("tells how a turn ended from its result, and counts a turn with an error or no result as failed", () => {
  const result = (fields: { isError?: boolean; stopped?: boolean }) => ({ kind: "item" as const, item: { type: "result" as const, id: "r", durationMs: 1, isError: false, ...fields } })
  const busy = { kind: "status" as const, busy: true }
  expect(outcomeAfter("error", busy)).toBe("error")
  expect(outcomeAfter("error", result({}))).toBe("done")
  expect(outcomeAfter("error", result({ stopped: true }))).toBe("interrupted")
  expect(outcomeAfter("error", result({ isError: true }))).toBe("error")
  expect(outcomeAfter("done", { kind: "item", item: { type: "error", id: "e", message: "lost" } })).toBe("error")
  expect(outcomeAfter("done", busy)).toBe("done")
})

/**
 * A project with one Claude transcript in it, kept in a temporary Claude config folder. The project's
 * path is resolved, as Claude Code names its folder after the real path.
 */
function startedThread() {
  process.env.CLAUDE_CONFIG_DIR ??= tempFolder("claude")
  const project = realpathSync(tempFolder("sessions"))
  const folder = join(process.env.CLAUDE_CONFIG_DIR, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"))
  mkdirSync(folder, { recursive: true })
  const sessionId = crypto.randomUUID()
  const message = { type: "user", uuid: crypto.randomUUID(), parentUuid: null, sessionId, cwd: project, timestamp: new Date().toISOString(), message: { role: "user", content: "Fix the login form" } }
  writeFileSync(join(folder, `${sessionId}.jsonl`), `${JSON.stringify(message)}\n`)
  const opened = open({ tabs: [{ ...tab("a", project), title: "Fix the login form" }], threads: { a: { sessionId } }, recent: [] })
  return { ...opened, project, sessionId, transcript: join(folder, `${sessionId}.jsonl`) }
}

test("renames a tab and its session, without a turn", async () => {
  const { window, sent, project } = startedThread()
  await window.renameThread("a", "  Login fix ")
  expect(sent).toContainEqual({ type: "tab.title", tabId: "a", title: "Login fix" })
  expect((await listSessions({ dir: project })).map((session) => session.summary)).toEqual(["Login fix"])
  await expect(window.renameThread("a", " ")).rejects.toThrow("needs a name")
})

test("forks a session into a new one under the tab's name", async () => {
  const { window, project, sessionId } = startedThread()
  const replies: CoreMessage[] = []
  await window.forkThread("a", (message) => replies.push(message))
  const forked = replies[0] as Extract<CoreMessage, { type: "thread.forked" }>
  expect(forked).toMatchObject({ type: "thread.forked", tabId: "a", title: "Fix the login form (fork)" })
  expect(forked.threadId).not.toBe(sessionId)
  expect((await listSessions({ dir: project })).map((session) => session.sessionId).sort()).toEqual([sessionId, forked.threadId].sort())
})

test("deletes a session's transcript and starts the tab afresh", async () => {
  const { window, sent, transcript } = startedThread()
  await window.deleteThread("a")
  expect(existsSync(transcript)).toBe(false)
  expect(saved().threads.a).toEqual({})
  expect(sent).toContainEqual({ type: "thread.session", tabId: "a" })
  expect(sent).toContainEqual({ type: "session.history", tabId: "a", items: [] })
})

test("refuses to rename, fork or delete a thread that has not started", async () => {
  const project = tempFolder("fresh")
  const { window } = open({ tabs: [tab("a", project)], threads: {}, recent: [] })
  await expect(window.renameThread("a", "Name")).rejects.toThrow("not started")
  await expect(window.forkThread("a", () => {})).rejects.toThrow("not started")
  await expect(window.deleteThread("a")).rejects.toThrow("not started")
})
