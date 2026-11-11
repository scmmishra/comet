import { afterAll } from "bun:test"
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
