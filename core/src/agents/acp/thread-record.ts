import { firstLine } from "../../text"
import type { ThreadItem } from "@desk/protocol"
import { existsSync, readFileSync } from "node:fs"
import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { writeJsonFile } from "../../data-files"
import type { AgentThreads } from "../agent"

/** One saved thread: the folder it ran in, its title, and its items in order. */
interface SavedThread {
  readonly dir: string
  readonly title: string
  readonly updatedAt: number
  readonly items: readonly ThreadItem[]
}

/** Requests leave the thread once answered, and one left open by a closed session can no longer be answered. */
const UNSAVED: ReadonlySet<ThreadItem["type"]> = new Set(["permission", "question"])

const threadPath = (folder: string, threadId: string) => join(folder, `${threadId}.json`)

function readThread(folder: string, threadId: string): SavedThread | undefined {
  const path = threadPath(folder, threadId)
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SavedThread) : undefined
}

/**
 * Desk's own record of one ACP session's thread. ACP reads a session back only by replaying it, and not
 * every agent can, so Desk keeps the items it showed. A resumed session adds to what was saved before.
 */
export class ThreadRecord {
  private readonly items = new Map<string, ThreadItem>()
  private threadId?: string

  constructor(
    private readonly folder: string,
    private readonly dir: string,
    resume?: string,
  ) {
    if (!resume) return
    this.threadId = resume
    for (const saved of readThread(folder, resume)?.items ?? []) this.items.set(saved.id, saved)
  }

  /** Keeps an item, in place of an earlier one with its id. */
  add(item: ThreadItem) {
    if (!UNSAVED.has(item.type)) this.items.set(item.id, item)
  }

  /** Names the session, once the agent has. Nothing is saved before. */
  name(threadId: string) {
    this.threadId = threadId
  }

  save() {
    if (!this.threadId) return
    const items = [...this.items.values()]
    const first = items.find((item) => item.type === "user")
    const title = first?.type === "user" ? firstLine(first.text) : ""
    writeJsonFile(threadPath(this.folder, this.threadId), { dir: this.dir, title, updatedAt: Date.now(), items } satisfies SavedThread)
  }
}

/**
 * Where an ACP agent's threads are saved, one file per session in `folder`. Sessions write their records
 * here, and Desk reads them back as `AgentThreads`. The folder is read at each call, so a test can move it.
 */
export class AcpThreadStore implements AgentThreads {
  constructor(private readonly folder: () => string) {}

  /** The record a session in `dir` writes. A resumed session adds to the thread saved before. */
  record(dir: string, resume?: string) {
    return new ThreadRecord(this.folder(), dir, resume)
  }

  async list(dir: string) {
    const names = await readdir(this.folder()).catch(() => [])
    const threads = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const saved = await readFile(join(this.folder(), name), "utf8")
            .then((text) => JSON.parse(text) as SavedThread)
            .catch(() => undefined)
          return saved?.dir === dir ? [{ id: name.slice(0, -".json".length), title: saved.title, updatedAt: saved.updatedAt }] : []
        }),
    )
    return threads.flat().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async history(_dir: string, threadId: string) {
    return [...(readThread(this.folder(), threadId)?.items ?? [])]
  }

  async context() {
    return undefined
  }

  delete(_dir: string, threadId: string) {
    return rm(threadPath(this.folder(), threadId), { force: true })
  }
}
