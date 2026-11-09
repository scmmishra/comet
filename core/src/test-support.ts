import { afterAll } from "bun:test"
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
