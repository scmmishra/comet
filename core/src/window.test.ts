import { expect, test } from "bun:test"
import type { CoreMessage, TabInfo } from "@desk/protocol"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fakeAgent, gitRepo, tempFolder, until, useTempHome } from "./test-support"
import { Agents } from "./agents/registry"
import { Delegations } from "./delegate/delegations"
import { Window } from "./window"
import { capture } from "./checkpoints"

useTempHome()

const tab = (id: string, project: string): TabInfo => ({ id, title: "New session", project, terminals: [], agent: "claude", model: "default", permissionMode: "default" })
const saved = () => JSON.parse(readFileSync(join(process.env.DESK_HOME!, "window.json"), "utf8"))

/** A window whose saved file holds `state`, the messages it sends, and each thread a tab moved to. */
function open(state: object) {
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify(state))
  const sent: CoreMessage[] = []
  const stale: string[] = []
  const shown: [string, string | undefined][] = []
  const agents = new Agents(() => {}, { compactIdle: () => false })
  const window = new Window({
    broadcast: (message) => sent.push(message),
    agents,
    delegations: new Delegations(agents, () => "http://127.0.0.1:0/mcp"),
    tabClosed: () => {},
    spaceStale: (project) => stale.push(project),
    turnEnded: () => {},
    threadShown: (tabId, threadKey) => shown.push([tabId, threadKey]),
  })
  return { window, sent, shown, stale }
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
  const { window, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: {} }, keyed: { [`${project}\nconv-2`]: { key: "conv-2", sessionId: "c2", agent: "claude" } }, recent: [] })
  await window.openKey("a", { key: "conv-1", prompt: "Draft a reply" })
  expect(claude.calls).toEqual(["send Draft a reply"])
  await window.openKey("a", { key: "conv-2", prompt: "Draft a reply" })
  expect(claude.calls).toEqual(["send Draft a reply"])
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

test("refuses to rename, fork or delete a thread that has not started", async () => {
  const project = tempFolder("fresh")
  const { window } = open({ tabs: [tab("a", project)], threads: {}, recent: [] })
  await expect(window.renameThread("a", "Name")).rejects.toThrow("not started")
  await expect(window.forkThread("a", () => {})).rejects.toThrow("not started")
  await expect(window.deleteThread("a")).rejects.toThrow("not started")
})

/** A window over fake agents: Claude with every thread feature, and a Codex that can only run turns. */
function openWithAgents(state: object) {
  const claude = fakeAgent("claude", ["steer", "rewind", "restore-files", "fork", "rename", "delete"], [{ id: "c1", title: "Older", updatedAt: 1 }])
  const codex = fakeAgent("codex", [], [{ id: "x1", title: "Newer", updatedAt: 2 }])
  writeFileSync(join(process.env.DESK_HOME!, "window.json"), JSON.stringify(state))
  const sent: CoreMessage[] = []
  const stale: string[] = []
  const ended: [string, string, string][] = []
  const agents = new Agents(() => {}, { compactIdle: () => false }, { claude: claude.make, codex: codex.make })
  const window = new Window({
    broadcast: (message) => sent.push(message),
    agents,
    delegations: new Delegations(agents, () => "http://127.0.0.1:0/mcp"),
    tabClosed: () => {},
    spaceStale: (project) => stale.push(project),
    turnEnded: (tabId, threadKey, outcome) => ended.push([tabId, threadKey, outcome]),
    threadShown: () => {},
  })
  return { window, sent, ended, stale, claude, codex }
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

test("renames a thread through its agent, and tells the app the tab's new title", async () => {
  const project = tempFolder("agents")
  const { window, sent, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  await window.renameThread("a", "  Login fix ")
  expect(claude.calls).toEqual(["rename c1 Login fix"])
  expect(sent).toContainEqual({ type: "tab.title", tabId: "a", title: "Login fix" })
  await expect(window.renameThread("a", " ")).rejects.toThrow("needs a name")
  expect(claude.calls).toEqual(["rename c1 Login fix"])
})

test("a session the agent renamed itself names its tab, without a rename back to the agent", async () => {
  const project = tempFolder("agents")
  const { window, sent, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  await window.send("a", "/rename Probe title")
  claude.sessions.at(-1)!.options.onRenamed!("Probe title")
  expect(sent).toContainEqual({ type: "tab.title", tabId: "a", title: "Probe title" })
  expect(claude.calls).toEqual(["send /rename Probe title"])
})

test("forks a thread under the tab's name, from a message when given, and answers with the copy", async () => {
  const project = tempFolder("agents")
  const { window, claude } = openWithAgents({ tabs: [{ ...tab("a", project), title: "Fix the login form" }], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  const replies: CoreMessage[] = []
  await window.forkThread("a", (message) => replies.push(message))
  await window.forkThread("a", (message) => replies.push(message), "u1")
  expect(claude.calls).toEqual(["fork c1", "fork c1 u1"])
  expect(replies[0]).toEqual({ type: "thread.forked", tabId: "a", agent: "claude", threadId: "c1-fork", title: "Fix the login form (fork)" })
})

test("deletes a thread through its agent, and starts the tab afresh", async () => {
  const project = tempFolder("agents")
  const { window, sent, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  await window.deleteThread("a")
  expect(claude.calls).toEqual(["delete c1"])
  expect(saved().threads.a).toEqual({})
  expect(sent).toContainEqual({ type: "thread.session", tabId: "a" })
  expect(sent).toContainEqual({ type: "session.history", tabId: "a", items: [] })
})

test("a rewind the agent resumes before hides the rewound messages, and the next session resumes there until its turn ends", async () => {
  const project = tempFolder("agents")
  const { window, sent, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  claude.rewound = { empty: false, resumeAt: "a0" }
  // The fake's history holds one message, c1-u1, so a rewind to it leaves the thread empty.
  await window.rewindThread("a", "c1-u1", false)
  expect(saved().threads.a.rewind).toEqual({ at: "a0", from: "c1-u1" })
  expect(sent.findLast((message) => message.type === "session.history")).toEqual({ type: "session.history", tabId: "a", items: [] })
  await window.send("a", "Try again")
  const { options } = claude.sessions.at(-1)!
  expect(options).toMatchObject({ resume: "c1", resumeAt: "a0" })
  options.onResumedAt!()
  expect(saved().threads.a.rewind).toBeUndefined()
})

test("a rewind to the first message leaves the tab to start a new session", async () => {
  const project = tempFolder("agents")
  const { window, sent, claude } = openWithAgents({ tabs: [tab("a", project)], threads: { a: { sessionId: "c1", agent: "claude" } }, recent: [] })
  claude.rewound = { empty: true }
  await window.rewindThread("a", "c1-u1", false)
  expect(saved().threads.a.sessionId).toBeUndefined()
  expect(sent).toContainEqual({ type: "thread.session", tabId: "a" })
  expect(sent).toContainEqual({ type: "session.history", tabId: "a", items: [] })
})

const codexTab = (id: string, project: string): TabInfo => ({ ...tab(id, project), agent: "codex" })

test("sends the next queued message once the turn ends", async () => {
  const project = tempFolder("queue")
  const { window, codex } = openWithAgents({ tabs: [codexTab("a", project)], threads: {}, recent: [] })
  await window.send("a", "one")
  await window.send("a", "two")
  await window.send("a", "three")
  codex.sessions[0]!.finish()
  await until(() => codex.calls.includes("send two"))
  expect(codex.calls).toEqual(["send one", "send two"])
  expect(saved().threads.a.queue).toMatchObject([{ text: "three" }])
})

test("holds the queue after a stop or an error, until it is resumed", async () => {
  const project = tempFolder("queue")
  const { window, sent, codex } = openWithAgents({ tabs: [codexTab("a", project), codexTab("b", project)], threads: {}, recent: [] })
  await window.send("a", "one")
  await window.send("a", "two")
  await window.interrupt("a")
  await until(() => !!saved().threads.a.queueHeld)
  expect(sent).toContainEqual({ type: "queue", tabId: "a", messages: [expect.objectContaining({ text: "two" })], held: true })
  expect(codex.calls).not.toContain("send two")
  window.resumeQueue("a")
  await until(() => codex.calls.includes("send two"))
  expect(saved().threads.a.queue).toEqual([])

  await window.send("b", "one")
  await window.send("b", "two")
  const session = codex.sessions.at(-1)!
  session.emit({ kind: "item", item: { type: "error", id: "e1", message: "lost" } })
  session.emit({ kind: "status", busy: false })
  await until(() => !!saved().threads.b.queueHeld)
  expect(saved().threads.b.queue).toMatchObject([{ text: "two" }])
})

test("sends a queued message into the running turn when asked, and keeps it queued for an agent that takes none", async () => {
  const project = tempFolder("queue")
  const { window, claude, codex } = openWithAgents({ tabs: [tab("a", project), codexTab("b", project)], threads: {}, recent: [] })
  await window.send("a", "one")
  await window.send("a", "/compact")
  await window.sendQueued("a", saved().threads.a.queue[0].id)
  expect(claude.calls).toEqual(["send one", "steer /compact"])
  expect(saved().threads.a.queue).toEqual([])

  await window.send("b", "one")
  await window.send("b", "two")
  await window.sendQueued("b", saved().threads.b.queue[0].id)
  expect(codex.calls).toEqual(["send one"])
  expect(saved().threads.b.queue).toMatchObject([{ text: "two" }])
})

test("tells the plugin how each turn of its thread ended", async () => {
  const project = tempFolder("outcome")
  const { window, ended, codex } = openWithAgents({ tabs: [codexTab("a", project)], threads: {}, recent: [] })
  await window.openKey("a", { key: "inbox.conv-1", prompt: "Draft a reply" })
  codex.sessions[0]!.finish()
  expect(ended).toEqual([["a", "inbox.conv-1", "done"]])
  await window.send("a", "again")
  await window.interrupt("a")
  expect(ended.at(-1)).toEqual(["a", "inbox.conv-1", "interrupted"])
  await window.send("a", "once more")
  codex.sessions[0]!.emit({ kind: "status", busy: false })
  expect(ended.at(-1)).toEqual(["a", "inbox.conv-1", "error"])
})

test("a turn goes on while its thread is away, and its session closes once the turn ends there", async () => {
  const project = tempFolder("parked")
  const { window, sent, ended, codex } = openWithAgents({ tabs: [codexTab("a", project)], threads: {}, recent: [] })
  await window.openKey("a", { key: "inbox.conv-1", prompt: "Draft a reply" })
  await window.openKey("a", { key: "inbox.conv-2" })
  expect(codex.calls).toEqual(["send Draft a reply"])
  sent.length = 0
  codex.sessions[0]!.finish()
  expect(ended).toEqual([["a", "inbox.conv-1", "done"]])
  expect(codex.calls).toEqual(["send Draft a reply", "close"])
  // Nothing of the away thread shows in the thread the tab moved to.
  expect(sent.filter((message) => message.type === "session.event")).toEqual([])
  expect(saved().keyed[`${project}\ninbox.conv-1`]).toMatchObject({ sessionId: "codex-session" })
})

test("a thread that comes back mid-turn shows as running, on the session that kept going", async () => {
  const project = tempFolder("parked")
  const { window, sent, codex } = openWithAgents({ tabs: [codexTab("a", project)], threads: {}, recent: [] })
  await window.openKey("a", { key: "inbox.conv-1", prompt: "Draft a reply" })
  await window.openKey("a", { key: "inbox.conv-2" })
  sent.length = 0
  await window.openKey("a", { key: "inbox.conv-1" })
  expect(sent).toContainEqual({ type: "session.event", tabId: "a", event: { kind: "status", busy: true } })
  codex.sessions[0]!.finish()
  expect(codex.calls).toEqual(["send Draft a reply"])
  expect(sent).toContainEqual({ type: "session.event", tabId: "a", event: { kind: "status", busy: false } })
})

test("lists the files a turn changed under its answer, and again when the thread is read back", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  const { window, sent, codex } = openWithAgents({ tabs: [codexTab("a", repo.dir)], threads: {}, recent: [] })
  await window.send("a", "Change it")
  repo.write("a.txt", "two\n")
  codex.sessions[0]!.finish()
  const changes = () => sent.flatMap((message) => (message.type === "session.event" && message.event.kind === "item" && message.event.item.type === "changes" ? [message.event.item] : []))
  await until(() => changes().length > 0)
  expect(changes()).toMatchObject([{ id: "changes:u1", files: [{ path: "a.txt" }] }])
  expect(await window.review("a", "turn")).toMatchObject([{ path: "a.txt" }])
  expect(saved().threads.a.turnChanges.u1).toMatchObject([{ path: "a.txt" }])
})

test("stopping the window closes the sessions that run while their thread is away", async () => {
  const project = tempFolder("parked")
  const { window, codex } = openWithAgents({ tabs: [codexTab("a", project)], threads: {}, recent: [] })
  await window.openKey("a", { key: "inbox.conv-1", prompt: "Draft a reply" })
  await window.openKey("a", { key: "inbox.conv-2" })
  window.stop()
  expect(codex.calls).toEqual(["send Draft a reply", "close"])
})

test("Review says why it could not read a thread's changes, and shows none for a folder that is not a Git repo", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  const missing = "0123456789abcdef0123456789abcdef01234567"
  const { window } = openWithAgents({ tabs: [codexTab("a", repo.dir), codexTab("b", tempFolder("plain"))], threads: { a: { turnFrom: missing, turnTo: missing } }, recent: [] })
  await expect(window.review("a", "turn")).rejects.toThrow("Review could not read the changes. git ")
  expect(await window.review("b", "git")).toEqual([])
})

test("keeps the checkpoints of a plugin's thread that no tab shows", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  const kept = (await capture(repo.dir))!
  repo.write("a.txt", "two\n")
  const dropped = (await capture(repo.dir))!
  openWithAgents({ tabs: [codexTab("a", repo.dir)], threads: {}, keyed: { [`${repo.dir}\ninbox.conv-1`]: { key: "inbox.conv-1", turnTo: kept } }, recent: [] })
  const refs = () => repo.git("for-each-ref", "--format=%(refname:lstrip=-1)", "refs/desk/")
  await until(() => !refs().includes(dropped))
  expect(refs()).toBe(kept)
})

test("a turn's end asks for the project's Space card again, as the turn may have switched branch or changed files", async () => {
  const project = tempFolder("space")
  const { window, stale, codex } = openWithAgents({ tabs: [codexTab("a", project)], threads: {}, recent: [] })
  await window.send("a", "one")
  expect(stale).toEqual([])
  codex.sessions[0]!.finish()
  expect(stale).toEqual([project])
})
