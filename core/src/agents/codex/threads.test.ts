import { expect, test } from "bun:test"
import { fakeAppServer } from "./fake-app-server"
import { AppServer } from "./server"
import { codexThreads } from "./threads"

const DIR = "/Users/ada/project"
const THREAD = "01a0d5eb-f0c0-7481-a417-5e8871805cbc"

const userMessage = (id: string, clientId: string | null, text: string, extra: object = {}) => ({ type: "userMessage", id, clientId, content: [{ type: "text", text, text_elements: [] }], ...extra })
const turn = (id: string, status: string, items: object[], extra: object = {}) => ({ id, items, itemsView: "full", status, error: null, startedAt: 1790295404, completedAt: 1790295409, durationMs: 4289, ...extra })

const TURNS = [
  turn("turn-1", "completed", [
    userMessage("u1", "desk-1", "Run the tests", { startedAtMs: 1790295404100 }),
    { type: "agentMessage", id: "msg_1", text: "All pass.", phase: "final_answer", completedAtMs: 1790295409000 },
  ]),
  turn("turn-2", "interrupted", [
    userMessage("u2", "desk-2", "Refactor it"),
    { type: "commandExecution", id: "exec-1", command: "/bin/zsh -lc 'npm test'", status: "completed", aggregatedOutput: "ok", exitCode: 0 },
    userMessage("u3", null, "Stop that", { startedAtMs: 1790295406000 }),
  ]),
  turn("turn-3", "failed", [userMessage("u4", null, "", { content: [{ type: "image", url: "data:image/png;base64,iVBOR" }] })], { error: { message: "Usage limit" }, durationMs: null }),
  turn("turn-4", "inProgress", [userMessage("u5", "desk-5", "Still going")]),
]

function setup() {
  const codex = fakeAppServer()
  codex.answer("thread/read", { thread: { id: THREAD, turns: TURNS } })
  return { codex, threads: codexThreads(new AppServer(codex.launch)) }
}

test("rebuilds a thread from Codex's turns, with the ids Desk gave its messages", async () => {
  const { codex, threads } = setup()
  const items = await threads.history(DIR, THREAD)
  expect(codex.sent("thread/read")).toEqual([{ threadId: THREAD, includeTurns: true }])
  expect(items).toEqual([
    { type: "user", id: "desk-1", text: "Run the tests", at: 1790295404100 },
    { type: "text", id: "msg_1", text: "All pass.", done: true, at: 1790295409000 },
    { type: "result", id: "result:desk-1", durationMs: 4289, isError: false },
    { type: "user", id: "desk-2", text: "Refactor it", at: 1790295404000 },
    { type: "tool", id: "exec-1", name: "Bash", summary: "npm test", result: { output: "ok", isError: false }, kind: "command", label: "Ran npm" },
    { type: "user", id: "u3", text: "Stop that", at: 1790295406000, steered: true },
    { type: "result", id: "result:desk-2", durationMs: 4289, isError: false, stopped: true },
    { type: "user", id: "u4", text: "", images: [{ mediaType: "image/png", data: "iVBOR" }], at: 1790295404000 },
    { type: "error", id: "error:turn-3", message: "Usage limit" },
    { type: "result", id: "result:u4", durationMs: 5000, isError: true },
    { type: "user", id: "desk-5", text: "Still going", at: 1790295404000 },
  ])
})

test("lists a project's threads by name, else by first line, newest first", async () => {
  const { codex, threads } = setup()
  codex.answer("thread/list", {
    data: [
      { id: "a", name: "Fix login", preview: "Fix it", updatedAt: 1794213133, gitInfo: { sha: "36395a", branch: "main", originUrl: null } },
      { id: "b", name: null, preview: "  Act as the reviewer\nfor this task", updatedAt: 1794207729, gitInfo: null },
    ],
    nextCursor: null,
  })
  expect(await threads.list(DIR)).toEqual([
    { id: "a", title: "Fix login", branch: "main", updatedAt: 1794213133000 },
    { id: "b", title: "Act as the reviewer", updatedAt: 1794207729000 },
  ])
  expect(codex.sent("thread/list")).toEqual([{ cwd: DIR, limit: 200, sortKey: "updated_at" }])
  codex.answer("thread/list", () => {
    throw new Error("No state DB")
  })
  expect(await threads.list(DIR)).toEqual([])
})

test("renames and deletes a thread", async () => {
  const { codex, threads } = setup()
  codex.answer("thread/name/set", {})
  codex.answer("thread/delete", {})
  await threads.rename!(DIR, THREAD, "New name")
  await threads.delete!(DIR, THREAD)
  expect(codex.sent("thread/name/set")).toEqual([{ threadId: THREAD, name: "New name" }])
  expect(codex.sent("thread/delete")).toEqual([{ threadId: THREAD }])
})

test("forks a thread through the turn of a message, and names the copy", async () => {
  const { codex, threads } = setup()
  codex.answer("thread/fork", { thread: { id: "copy" } })
  codex.answer("thread/name/set", {})
  expect(await threads.fork!(DIR, THREAD, { title: "Fork of tests", messageId: "desk-2" })).toBe("copy")
  expect(codex.sent("thread/fork")).toEqual([{ threadId: THREAD, lastTurnId: "turn-2", excludeTurns: true }])
  expect(codex.sent("thread/name/set")).toEqual([{ threadId: "copy", name: "Fork of tests" }])
  await threads.fork!(DIR, THREAD, { title: "Whole" })
  expect(codex.sent("thread/fork")[1]).toEqual({ threadId: THREAD, excludeTurns: true })
})

test("rewinds to before a message's turn, and leaves a thread rewound to its first message empty", async () => {
  const { codex, threads } = setup()
  codex.answer("thread/resume", { thread: { id: THREAD } })
  codex.answer("thread/revert", { thread: { id: THREAD } })
  expect(await threads.rewind!(DIR, THREAD, "desk-1")).toEqual({ empty: true })
  expect(codex.sent("thread/revert")).toEqual([])
  expect(await threads.rewind!(DIR, THREAD, "u4")).toEqual({ empty: false })
  expect(codex.sent("thread/resume")).toEqual([{ threadId: THREAD, cwd: DIR, excludeTurns: true }])
  expect(codex.sent("thread/revert")).toEqual([{ threadId: THREAD, beforeTurnId: "turn-3" }])
  expect(await threads.rewind!(DIR, THREAD, "nope").catch((error: Error) => error.message)).toBe("Codex has no such message in the thread.")
})

test("has no context reading for a thread at rest", async () => {
  expect(await setup().threads.context(DIR, THREAD)).toBeUndefined()
})
