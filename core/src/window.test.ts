import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk"
import { expect, test } from "bun:test"
import type { CoreMessage, TabInfo } from "@desk/protocol"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { claudeTranscript, fakeAgent, gitRepo, tempFolder, type TranscriptEntry, useTempHome } from "./test-support"
import { Agents } from "./agents/registry"
import { outcomeAfter, Window } from "./window"

useTempHome()

const tab = (id: string, project: string): TabInfo => ({ id, title: "New session", project, terminals: [], agent: "claude", model: "default", permissionMode: "default" })
const saved = () => JSON.parse(readFileSync(join(process.env.DESK_HOME!, "window.json"), "utf8"))

/** A window whose saved file holds `state`, the messages it sends, and each thread a tab moved to. */
function open(state: object) {
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify(state))
  const sent: CoreMessage[] = []
  const shown: [string, string | undefined][] = []
  const window = new Window({
    broadcast: (message) => sent.push(message),
    agents: new Agents(() => {}, { compactIdle: () => false }),
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
function startedThread(entries: readonly TranscriptEntry[] = [{ user: "Fix the login form" }]) {
  const { project, sessionId, file, uuids } = claudeTranscript(entries)
  const opened = open({ tabs: [{ ...tab("a", project), title: "Fix the login form" }], threads: { a: { sessionId } }, recent: [] })
  return { ...opened, project, sessionId, transcript: file, uuids }
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

/** Two turns: the user's message and Claude's reply, twice. */
const TWO_TURNS: readonly TranscriptEntry[] = [{ user: "Fix the login form" }, { assistant: "Fixed it." }, { user: "Now add a test" }, { assistant: "Added one." }]

test("rewinds a thread to before a message: the thread hides it and what follows, and the next session resumes before it", async () => {
  const { window, sent, uuids } = startedThread(TWO_TURNS)
  await window.rewindThread("a", uuids[2]!, false)
  expect(saved().threads.a.rewind).toEqual({ at: uuids[1], from: uuids[2] })
  const history = sent.findLast((message): message is Extract<CoreMessage, { type: "session.history" }> => message.type === "session.history")!
  expect(history.items.filter((item) => item.type === "user").map((item) => item.id)).toEqual([uuids[0]])
})

test("a rewind to the first message leaves the tab to start a new session", async () => {
  const { window, sent, uuids } = startedThread(TWO_TURNS)
  await window.rewindThread("a", uuids[0]!, false)
  expect(saved().threads.a.sessionId).toBeUndefined()
  expect(sent).toContainEqual({ type: "thread.session", tabId: "a" })
  expect(sent).toContainEqual({ type: "session.history", tabId: "a", items: [] })
})

test("refuses to rewind to a message that is not one the user sent", async () => {
  const { window, uuids } = startedThread(TWO_TURNS)
  await expect(window.rewindThread("a", uuids[1]!, false)).rejects.toThrow("could not find that message")
})

test("forks a thread from a message: the copy ends with that message's turn", async () => {
  const { window, project, uuids } = startedThread(TWO_TURNS)
  const replies: CoreMessage[] = []
  await window.forkThread("a", (message) => replies.push(message), uuids[0])
  const forked = replies[0] as Extract<CoreMessage, { type: "thread.forked" }>
  const copy = await getSessionMessages(forked.threadId, { dir: project })
  expect(copy.map((message) => message.type)).toEqual(["user", "assistant"])
})

/** A window over fake agents: Claude with every thread feature, and a Codex that can only run turns. */
function openWithAgents(state: object) {
  const claude = fakeAgent("claude", ["steer", "rewind", "restore-files", "fork", "rename", "delete"], [{ id: "c1", title: "Older", updatedAt: 1 }])
  const codex = fakeAgent("codex", [], [{ id: "x1", title: "Newer", updatedAt: 2 }])
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify(state))
  const sent: CoreMessage[] = []
  const window = new Window({
    broadcast: (message) => sent.push(message),
    agents: new Agents(() => {}, { compactIdle: () => false }, { claude: claude.make, codex: codex.make }),
    tabClosed: () => {},
    turnEnded: () => {},
    threadShown: () => {},
  })
  return { window, sent, claude, codex }
}

test("runs a tab on the agent it names, and its thread stays on the agent that started it", async () => {
  const project = tempFolder("agents")
  const { window, sent, claude, codex } = openWithAgents({ tabs: [{ ...tab("a", project), agent: "codex" }], threads: {}, recent: [] })
  await window.send("a", "hello")
  expect(codex.calls).toEqual(["send hello"])
  expect(claude.calls).toEqual([])
  expect(saved().threads.a).toMatchObject({ sessionId: "codex-session", agent: "codex" })
  expect(sent).toContainEqual({ type: "thread.session", tabId: "a", sessionId: "codex-session", agent: "codex" })
  // The app may still name another agent for the tab. The thread's own agent answers.
  window.save([tab("a", project)], "a")
  await window.send("a", "again")
  expect(codex.calls).toContain("send again")
  expect(claude.calls).toEqual([])
})

test("a tab that changes its agent before its thread starts opens its session on the new one", async () => {
  const project = tempFolder("agents")
  const { window, claude, codex } = openWithAgents({ tabs: [tab("a", project)], threads: {}, recent: [] })
  window.save([{ ...tab("a", project), agent: "codex" }], "a")
  await window.send("a", "hello")
  expect(codex.calls).toEqual(["send hello"])
  expect(claude.calls).toEqual([])
})

test("a message sent mid-turn steers an agent that takes one, and queues for an agent that does not", async () => {
  const project = tempFolder("agents")
  const { window, claude, codex } = openWithAgents({ tabs: [tab("a", project), { ...tab("b", project), agent: "codex" }], threads: {}, recent: [] })
  await window.send("a", "one")
  await window.send("a", "two", [], "steer")
  expect(claude.calls).toEqual(["send one", "steer two"])
  await window.send("b", "one")
  await window.send("b", "two", [], "steer")
  expect(codex.calls).toEqual(["send one"])
  expect(saved().threads.b.queue).toMatchObject([{ text: "two" }])
})

test("lists a project's threads across agents, newest first, each with its agent and the tab that shows it", async () => {
  const project = tempFolder("agents")
  const { window } = openWithAgents({ tabs: [{ ...tab("a", project), agent: "codex" }], threads: { a: { sessionId: "x1", agent: "codex" } }, recent: [] })
  expect(await window.recentThreads(project)).toEqual([
    { id: "x1", title: "Newer", updatedAt: 2, agent: "codex", tabId: "a" },
    { id: "c1", title: "Older", updatedAt: 1, agent: "claude" },
  ])
})

test("resumes a past thread on the agent it ran on, and reads its history from that agent", async () => {
  const project = tempFolder("agents")
  const { window } = openWithAgents({ tabs: [tab("a", project)], threads: {}, recent: [] })
  const replies: CoreMessage[] = []
  await window.resume("a", "codex", "x1", (message) => replies.push(message))
  expect(replies).toEqual([{ type: "session.history", tabId: "a", items: [{ type: "user", id: "x1-u1", text: "From codex" }] }])
  expect(saved().threads.a).toEqual({ sessionId: "x1", agent: "codex" })
})

test("refuses what a thread's agent cannot do, and says which agent", async () => {
  const project = tempFolder("agents")
  const { window, codex } = openWithAgents({ tabs: [{ ...tab("a", project), agent: "codex" }], threads: { a: { sessionId: "x1", agent: "codex" } }, recent: [] })
  await expect(window.renameThread("a", "Name")).rejects.toThrow("Fake codex cannot rename a thread.")
  await expect(window.forkThread("a", () => {})).rejects.toThrow("Fake codex cannot fork a thread.")
  await expect(window.deleteThread("a")).rejects.toThrow("Fake codex cannot delete a thread.")
  await expect(window.rewindThread("a", "u1", false)).rejects.toThrow("Fake codex cannot rewind a thread.")
  expect(codex.calls).toEqual([])
})

test("rewinds through the thread's agent, restoring files first when asked, and keeps a transcript the agent already cut", async () => {
  const project = tempFolder("agents")
  const { window, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  await window.rewindThread("a", "u1", true)
  expect(claude.calls).toEqual(["restore u1", "close", "rewind c1 u1"])
  expect(saved().threads.a).toMatchObject({ sessionId: "c1", agent: "claude" })
  expect(saved().threads.a.rewind).toBeUndefined()
})
