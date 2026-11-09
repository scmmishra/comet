import { query, type CanUseTool, type PermissionResult, type Query, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { DEFAULT_MODEL, type RunSettings, type ThreadEvent } from "@desk/protocol"
import { ThreadMapper } from "./thread"

type Emit = (event: ThreadEvent) => void

/** A queue the SDK reads user messages from. A session stays open between turns while it waits. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void
  private closed = false

  push(item: SDKUserMessage) {
    if (this.waiting) {
      this.waiting({ value: item, done: false })
      this.waiting = undefined
    } else this.items.push(item)
  }

  close() {
    this.closed = true
    this.waiting?.({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      },
    }
  }
}

export interface SessionOptions {
  /** A Claude session to continue, from an earlier run of Desk. */
  readonly resume?: string
  readonly settings: RunSettings
  /** Called when Claude names the session, so it can be resumed later. */
  readonly onSessionId?: (id: string) => void
  /** Called with each plan rate-limit update Claude sends during a turn. */
  readonly onRateLimit?: (info: SDKRateLimitInfo) => void
}

/** One Claude conversation, in one tab. It starts on the first message. */
export class Session {
  private inbox = new Inbox()
  private query?: Query
  private mapper = new ThreadMapper()
  private permissions = new Map<string, (result: PermissionResult) => void>()
  private sent = 0
  private sessionId?: string
  private settings: RunSettings

  constructor(
    private readonly dir: string,
    private readonly emit: Emit,
    private readonly options: SessionOptions,
  ) {
    this.sessionId = options.resume
    this.settings = options.settings
  }

  /** Changes how the thread runs. A running thread takes the change from its next reply. */
  async configure(settings: RunSettings) {
    this.settings = settings
    if (!this.query) return
    await this.query.setModel(sdkModel(settings.model))
    // null drops a flag, so the model's default effort, or standard speed, applies again.
    await this.query.applyFlagSettings({ effortLevel: settings.effort ?? null, fastMode: settings.fast || null })
    await this.query.setPermissionMode(settings.permissionMode)
  }

  send(text: string) {
    this.emit({ kind: "user", id: `user-${++this.sent}`, text })
    this.emit({ kind: "status", busy: true })
    this.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })
    if (!this.query) this.start()
  }

  async interrupt() {
    await this.query?.interrupt()
  }

  close() {
    for (const resolve of this.permissions.values()) resolve({ behavior: "deny", message: "The tab was closed." })
    this.permissions.clear()
    this.inbox.close()
    this.query?.close()
  }

  answerPermission(id: string, allow: boolean) {
    const resolve = this.permissions.get(id)
    if (!resolve) return
    this.permissions.delete(id)
    this.emit({ kind: "permission.resolved", id, allowed: allow })
    resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: "The user declined this tool call." })
  }

  private start() {
    this.query = query({
      prompt: this.inbox,
      options: {
        cwd: this.dir,
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code" },
        canUseTool: this.askPermission,
        model: sdkModel(this.settings.model),
        ...(this.settings.effort ? { effort: this.settings.effort } : {}),
        ...(this.settings.fast ? { settings: { fastMode: true } } : {}),
        permissionMode: this.settings.permissionMode,
        // Full access needs this at start. Passing it always lets a thread switch to Full access later.
        // It allows the mode and does not set it.
        allowDangerouslySkipPermissions: true,
        ...(this.sessionId ? { resume: this.sessionId } : {}),
      },
    })
    void this.pump(this.query)
  }

  private async pump(running: Query) {
    try {
      for await (const message of running) {
        if (message.session_id && message.session_id !== this.sessionId) {
          this.sessionId = message.session_id
          this.options.onSessionId?.(message.session_id)
        }
        if (message.type === "rate_limit_event") this.options.onRateLimit?.(message.rate_limit_info)
        for (const event of this.mapper.map(message)) this.emit(event)
        if (message.type === "result") {
          this.emit({ kind: "status", busy: false })
          void this.reportContext(running)
        }
      }
    } catch (error) {
      this.emit({ kind: "error", id: `error-${Date.now()}`, message: error instanceof Error ? error.message : String(error) })
      this.emit({ kind: "status", busy: false })
      this.query = undefined
    }
  }

  /** "summary" answers from the last response's usage, without asking the API to count tokens. */
  private async reportContext(running: Query) {
    try {
      const usage = await running.getContextUsage({ detail: "summary" })
      this.emit({ kind: "context", percent: usage.percentage, tokens: usage.totalTokens, maxTokens: usage.maxTokens })
    } catch {
      // Context usage is extra information. A turn still counts as done without it.
    }
  }

  private askPermission: CanUseTool = (tool, input, { signal, toolUseID: id }) =>
    new Promise((resolve) => {
      this.permissions.set(id, resolve)
      signal.addEventListener("abort", () => {
        this.permissions.delete(id)
        resolve({ behavior: "deny", message: "The request was cancelled." })
      })
      this.emit({ kind: "permission", id, tool, input })
    })
}

/** Claude Code's default model is the absence of a model option. */
const sdkModel = (model: string) => (model === DEFAULT_MODEL ? undefined : model)

/** Whether two tabs run the same way, so a save can skip reconfiguring a session. */
export const sameRunSettings = (a: RunSettings, b: RunSettings) =>
  a.model === b.model && a.effort === b.effort && !!a.fast === !!b.fast && a.permissionMode === b.permissionMode
