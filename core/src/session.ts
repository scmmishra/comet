import { query, type CanUseTool, type PermissionResult, type Query, type SDKMessage, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ImageAttachment, RunSettings, ThreadEvent, ThreadItem } from "@desk/protocol"
import { readContext } from "./context"
import { sdkModel } from "./models"
import { Subagents } from "./subagents"
import { ThreadMapper, toolDetail } from "./thread"

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

interface SessionOptions {
  /** A Claude session to continue, from an earlier run of Desk. */
  readonly resume?: string
  readonly settings: RunSettings
  /** Called when Claude names the session, so it can be resumed later. */
  readonly onSessionId: (id: string) => void
  /** Called with each plan rate-limit update Claude sends during a turn. */
  readonly onRateLimit: (info: SDKRateLimitInfo) => void
  /** Whether to compact a large thread that sat idle, when Claude Code asks on its return. Read at each ask. */
  readonly compactIdle: () => boolean
}

/** One Claude conversation, in one tab. It starts on the first message. */
export class Session {
  /** Each query reads its own inbox. A failed query's input loop may still wait on its inbox, and must not take the next message. */
  private inbox = new Inbox()
  private query?: Query
  private mapper: ThreadMapper
  private subagents: Subagents
  /** Open permission requests: how to answer each, and the item that shows it. */
  private permissions = new Map<string, { readonly resolve: (result: PermissionResult) => void; readonly item: Extract<ThreadItem, { type: "permission" }> }>()
  private sessionId?: string
  /** Set while a turn the user stopped winds down, until its result arrives. */
  private stopping = false
  private running = false
  /** Set from a steered message until Claude Code takes it in, or its turn ends without it. */
  private steering = false
  private settings: RunSettings

  constructor(
    private readonly dir: string,
    private readonly emit: Emit,
    private readonly options: SessionOptions,
  ) {
    this.sessionId = options.resume
    this.settings = options.settings
    this.mapper = new ThreadMapper(dir)
    this.subagents = new Subagents(dir, emit)
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

  /** Whether a turn runs, from a message until its turn's final result. */
  get busy() {
    return this.running
  }

  /** Starts a turn with a message. */
  send(text: string, images: readonly ImageAttachment[] = []) {
    // Claude Code keeps the message's uuid in the transcript, so the item has the same id live and restored.
    const uuid = crypto.randomUUID()
    this.emit({ kind: "item", item: { type: "user", id: uuid, text, ...(images.length ? { images } : {}), at: Date.now() } })
    this.running = true
    this.emit({ kind: "status", busy: true })
    if (!this.query) this.inbox = new Inbox()
    this.inbox.push({ type: "user", message: { role: "user", content: userContent(text, images) }, parent_tool_use_id: null, uuid })
    if (!this.query) this.start()
  }

  /**
   * Sends a message into the running turn. Claude Code cuts the turn's current step short, reports that
   * step's end as an aborted result, and goes on with the message. A turn that ends before the message
   * lands takes it as its next turn instead.
   */
  steer(text: string, images: readonly ImageAttachment[] = []) {
    if (!this.running) return this.send(text, images)
    const uuid = crypto.randomUUID()
    this.emit({ kind: "item", item: { type: "user", id: uuid, text, ...(images.length ? { images } : {}), at: Date.now(), steered: true } })
    this.steering = true
    this.inbox.push({ type: "user", message: { role: "user", content: userContent(text, images) }, parent_tool_use_id: null, priority: "now", uuid })
  }

  async interrupt() {
    if (!this.query) return
    this.stopping = true
    await this.query.interrupt()
  }

  close() {
    for (const { resolve } of this.permissions.values()) resolve({ behavior: "deny", message: "The tab was closed." })
    this.permissions.clear()
    this.inbox.close()
    this.query?.close()
  }

  answerPermission(requestId: string, allow: boolean) {
    const request = this.permissions.get(requestId)
    if (!request) return
    this.permissions.delete(requestId)
    this.emit({ kind: "item", item: { ...request.item, answer: allow } })
    request.resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: "The user declined this tool call." })
  }

  private start() {
    this.query = query({
      prompt: this.inbox,
      options: {
        cwd: this.dir,
        includePartialMessages: true,
        // A subagent's text and thinking reach Desk too, with a one-line status, for its card.
        forwardSubagentText: true,
        agentProgressSummaries: true,
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
        // Claude Code asks whether to compact a large thread that sat idle. The setting answers, so no dialog shows.
        supportedDialogKinds: ["resume_return"],
        onUserDialog: async (request) =>
          request.dialogKind === "resume_return" ? { behavior: "completed", result: this.options.compactIdle() ? "compact" : "continue" } : { behavior: "cancelled" },
      },
    })
    void this.pump(this.query)
  }

  private async pump(running: Query) {
    try {
      for await (const message of running) {
        if (message.session_id && message.session_id !== this.sessionId) {
          this.sessionId = message.session_id
          this.options.onSessionId(message.session_id)
        }
        if (message.type === "rate_limit_event") this.options.onRateLimit(message.rate_limit_info)
        this.subagents.handle(message)
        if (message.type === "result" && this.steered(message)) continue
        for (const event of this.mapper.map(message, Date.now())) {
          // The result of a turn the user stopped says so, so the thread can tell it from one that finished.
          const stopped = this.stopping && event.kind === "item" && event.item.type === "result"
          this.emit(stopped ? { ...event, item: { ...event.item, stopped: true } } : event)
        }
        if (message.type === "result") {
          this.stopping = false
          // A steered message that missed the turn starts the next one, so the tab stays busy.
          if (this.steering) {
            this.steering = false
            continue
          }
          this.running = false
          this.emit({ kind: "status", busy: false })
          void this.reportContext(running)
        }
      }
    } catch (error) {
      this.running = false
      this.steering = false
      this.emit({ kind: "item", item: { type: "error", id: `error-${Date.now()}`, message: error instanceof Error ? error.message : String(error) } })
      this.emit({ kind: "status", busy: false })
      this.inbox.close()
      this.query = undefined
    }
  }

  /** Whether a result only ends the step a steered message cut short. The turn goes on with the message. */
  private steered(result: Extract<SDKMessage, { type: "result" }>) {
    const cut = result.terminal_reason === "aborted_streaming" || result.terminal_reason === "aborted_tools"
    if (!cut || !this.steering || this.stopping) return false
    this.steering = false
    return true
  }

  private async reportContext(running: Query) {
    try {
      this.emit({ kind: "context", reading: await readContext(running) })
    } catch {
      // Context usage is extra information. A turn still counts as done without it.
    }
  }

  /** A request shows as its own item. Its id differs from the tool call's, which shows separately once allowed. */
  private askPermission: CanUseTool = (tool, input, { signal, toolUseID: requestId }) =>
    new Promise((resolve) => {
      const item = { type: "permission", id: `permission:${requestId}`, requestId, tool, detail: toolDetail(input) } as const
      this.permissions.set(requestId, { resolve, item })
      // An interrupted turn cancels its request, which then shows as declined.
      signal.addEventListener("abort", () => {
        this.permissions.delete(requestId)
        this.emit({ kind: "item", item: { ...item, answer: false } })
        resolve({ behavior: "deny", message: "The request was cancelled." })
      })
      this.emit({ kind: "item", item })
    })
}

/** Whether two tabs run the same way, so a save can skip reconfiguring a session. */
export const sameRunSettings = (a: RunSettings, b: RunSettings) =>
  a.model === b.model && a.effort === b.effort && !!a.fast === !!b.fast && a.permissionMode === b.permissionMode

/** A message's content for Claude. Images go before the text, as the API recommends. */
function userContent(text: string, images: readonly ImageAttachment[]) {
  if (!images.length) return text
  const blocks = images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } }))
  return [...blocks, ...(text ? [{ type: "text" as const, text }] : [])]
}
