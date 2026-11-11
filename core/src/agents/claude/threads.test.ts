import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder } from "../../test-support"
import { claudeThreads } from "./threads"

/** One entry of a Claude transcript: a message the user sent, or Claude's text reply. */
type TranscriptEntry = { readonly user: string } | { readonly assistant: string }

/**
 * A Claude transcript in a new project, kept in a temporary Claude config folder for the file's tests.
 * Each entry follows the one before it. The project's path is resolved, as Claude Code names its folder
 * after the real path. Answers the project, the session, the transcript's file and each entry's uuid.
 */
function claudeTranscript(entries: readonly TranscriptEntry[]) {
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

/** Two turns: the user's message and Claude's reply, twice. */
const TWO_TURNS: readonly TranscriptEntry[] = [{ user: "Fix the login form" }, { assistant: "Fixed it." }, { user: "Now add a test" }, { assistant: "Added one." }]

test("renames a thread, and the thread list shows the new name", async () => {
  const { project, sessionId } = claudeTranscript([{ user: "Fix the login form" }])
  await claudeThreads.rename!(project, sessionId, "Login fix")
  expect((await claudeThreads.list(project)).map((thread) => [thread.id, thread.title])).toEqual([[sessionId, "Login fix"]])
})

test("forks a thread into a new one, and keeps the original", async () => {
  const { project, sessionId } = claudeTranscript([{ user: "Fix the login form" }])
  const copy = await claudeThreads.fork!(project, sessionId, { title: "Fix the login form (fork)" })
  expect(copy).not.toBe(sessionId)
  expect((await claudeThreads.list(project)).map((thread) => thread.id).sort()).toEqual([sessionId, copy].sort())
})

test("forks a thread from a message: the copy ends with that message's turn", async () => {
  const { project, sessionId, uuids } = claudeTranscript(TWO_TURNS)
  const copy = await claudeThreads.fork!(project, sessionId, { title: "Copy", messageId: uuids[0] })
  expect((await getSessionMessages(copy, { dir: project })).map((message) => message.type)).toEqual(["user", "assistant"])
})

test("deletes a thread's transcript", async () => {
  const { project, sessionId, file } = claudeTranscript([{ user: "Fix the login form" }])
  await claudeThreads.delete!(project, sessionId)
  expect(existsSync(file)).toBe(false)
})

test("rewinds to before a message: the thread resumes at the message before it", async () => {
  const { project, sessionId, uuids } = claudeTranscript(TWO_TURNS)
  expect(await claudeThreads.rewind!(project, sessionId, uuids[2]!)).toEqual({ empty: false, resumeAt: uuids[1] })
})

test("a rewind to the first message leaves nothing to resume", async () => {
  const { project, sessionId, uuids } = claudeTranscript(TWO_TURNS)
  expect(await claudeThreads.rewind!(project, sessionId, uuids[0]!)).toEqual({ empty: true })
})

test("refuses to rewind to a message that is not one the user sent", async () => {
  const { project, sessionId, uuids } = claudeTranscript(TWO_TURNS)
  await expect(claudeThreads.rewind!(project, sessionId, uuids[1]!)).rejects.toThrow("could not find that message")
})
