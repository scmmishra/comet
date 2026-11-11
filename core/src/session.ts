import { query, type CanUseTool, type PermissionResult, type Query, type SDKMessage, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ImageAttachment, PermissionAnswer, RunSettings, ThreadEvent, ThreadItem } from "@desk/protocol"
import { readContext } from "./context"
import { sdkModel } from "./models"
import { BackgroundTasks } from "./background-tasks"
import { claudeCodePath } from "./claude-code"
import { Subagents } from "./subagents"
import { ASK_USER_QUESTION, permissionItem, permissionResult, questionItem, questionResult } from "./requests"
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

interface SessionOptions {
  /** A Claude session to continue, from an earlier run of Desk. */
  readonly resume?: string
  /**
   * Where a rewound thread resumes: the last message `resume` keeps. Claude Code drops what follows from
   * the conversation once the next turn runs. `onResumedAt` says when that turn has ended.
   */
  readonly resumeAt?: string
  readonly onResumedAt?: () => void
  readonly settings: RunSettings
  /** Called when Claude names the session, so it can be resumed later. */
  readonly onSessionId: (id: string) => void
  /** Called with each plan rate-limit update Claude sends during a turn. */
  readonly onRateLimit: (info: SDKRateLimitInfo) => void
  /** Whether to compact a large thread that sat idle, when Claude Code asks on its return. Read at each ask. */
  readonly compactIdle: () => boolean
}

/** One Claude conversation, in one tab. It starts on the first message. */
type RequestSuggestions = Parameters<CanUseTool>[2]["suggestions"]

/** A request waiting for the user: the item that shows it, what Claude asked with, and how to answer Claude Code. */
interface OpenRequest {
  readonly item: Extract<ThreadItem, { type: "permission" | "question" }>
  readonly tool: string
  readonly input: Record<string, unknown>
  readonly suggestions: RequestSuggestions
  readonly resolve: (result: PermissionResult) => void
}

export class Session {
  /** Each query reads its own inbox. A failed query's input loop may still wait on its inbox, and must not take the next message. */
  private inbox = new Inbox()
  private query?: Query
  private mapper: ThreadMapper
  private subagents: Subagents
  private backgroundTasks: BackgroundTasks
  /** Open requests, permissions and questions, by request id. */
  private requests = new Map<string, OpenRequest>()
  private sessionId?: string
  /** Set while a turn the user stopped winds down, until its result arrives. */
  private stopping = false
  /** Marks a stop unresponsive once it has waited too long. */
  private unresponsive?: ReturnType<typeof setTimeout>
  private running = false
  /** Set from the first message, while Claude Code is found and started, until the session fails. */
  private started = false
  /** Set from a steered message until Claude Code takes it in, or its turn ends without it. */
  private steering = false
  private settings: RunSettings
  /** Where the next query resumes, until a turn has run there. Later queries resume at the end, as usual. */
  private resumeAt?: string

  constructor(
    private readonly dir: string,
    private readonly emit: Emit,
    private readonly options: SessionOptions,
  ) {
    this.sessionId = options.resume
    this.resumeAt = options.resumeAt
    this.settings = options.settings
    this.mapper = new ThreadMapper(dir)
    this.subagents = new Subagents(dir, emit)
    this.backgroundTasks = new BackgroundTasks(emit)
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
    if (!this.started) this.inbox = new Inbox()
    this.inbox.push({ type: "user", message: { role: "user", content: userContent(text, images) }, parent_tool_use_id: null, uuid })
    if (!this.started) void this.start()
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

  /** Stops commands running in the background. Claude Code reports each as stopped once it ends. */
  async stopTasks(ids: readonly string[]) {
    await Promise.all(ids.map((id) => this.query?.stopTask(id)))
  }

  /**
   * Asks the turn to stop. If Claude Code has not stopped in time, the tab says so and offers Force
   * stop, after T3 Code.
   */
  async interrupt() {
    if (!this.query || this.stopping) return
    this.stopping = true
    const since = Date.now()
    this.emit({ kind: "stopping", since, unresponsive: false })
    clearTimeout(this.unresponsive)
    this.unresponsive = setTimeout(() => this.stopping && this.emit({ kind: "stopping", since, unresponsive: true }), UNRESPONSIVE_AFTER_MS)
    await this.query.interrupt()
  }

  /**
   * Ends a turn that did not stop when asked, as stopped. The window then closes the session, which ends
   * Claude Code, and the next message starts a new one on the same thread. Says whether there was a stop to force.
   */
  forceStop(): boolean {
    if (!this.stopping) return false
    this.emit({ kind: "item", item: { type: "result", id: `result:forced-${Date.now()}`, durationMs: 0, isError: false, stopped: true } })
    this.endTurn()
    return true
  }

  /** What a turn's end resets, and the status that tells the tab. */
  private endTurn() {
    this.stopping = false
    clearTimeout(this.unresponsive)
    this.running = false
    this.emit({ kind: "status", busy: false })
  }

  close() {
    clearTimeout(this.unresponsive)
    for (const { resolve } of this.requests.values()) resolve({ behavior: "deny", message: "The tab was closed." })
    this.requests.clear()
    this.inbox.close()
    this.query?.close()
  }

  /**
   * Restores the files Claude's tools changed from `messageId` on, from the copies Claude Code kept. A
   * session that has not started opens Claude Code without a message, so nothing reaches the model.
   * Changes made another way, such as through Bash, stay.
   */
  async rewindFiles(messageId: string) {
    if (!this.started) {
      this.inbox = new Inbox()
      await this.start()
    }
    if (!this.query) throw new Error("Claude Code did not start, so Desk could not restore the files.")
    const result = await this.query.rewindFiles(messageId)
    if (!result.canRewind) throw new Error(result.error ?? "Claude Code kept no copies of the files from that message.")
  }

  answerPermission(requestId: string, answer: PermissionAnswer) {
    this.answer(requestId, "permission", (input, tool, suggestions) => permissionResult(answer, tool, input, suggestions))
  }

  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined) {
    this.answer(requestId, "question", (input) => questionResult(input, answers))
  }

  /** Answers an open request of `type`. A stale answer, or one for another kind of request, is ignored. */
  private answer(requestId: string, type: OpenRequest["item"]["type"], result: (input: Record<string, unknown>, tool: string, suggestions: RequestSuggestions) => PermissionResult) {
    const request = this.requests.get(requestId)
    if (request?.item.type !== type) return
    this.respond(request, result(request.input, request.tool, request.suggestions))
  }

  /**
   * Starts Claude Code on the inbox. It is marked started before it finds Claude Code, so a message sent
   * meanwhile joins this inbox rather than opening a second session.
   */
  private async start() {
    this.started = true
    let executable: string
    try {
      executable = await claudeCodePath()
    } catch (error) {
      return this.fail(error)
    }
    this.query = query({
      prompt: this.inbox,
      options: {
        pathToClaudeCodeExecutable: executable,
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
        ...(this.sessionId && this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}),
        // Claude Code keeps a copy of each file before its tools edit it, so a rewind can restore them.
        enableFileCheckpointing: true,
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
        this.backgroundTasks.handle(message)
        if (message.type === "result" && this.steered(message)) continue
        for (const event of this.mapper.map(message, Date.now())) {
          // The result of a turn the user stopped says so, so the thread can tell it from one that finished.
          // A turn Claude Code starts itself, after a background task, makes the tab busy again.
          if (event.kind === "status" && event.busy) this.running = true
          this.emit(this.stopping ? stoppedEvent(event) : event)
        }
        // A compaction changes how much of the context is used.
        if (message.type === "system" && message.subtype === "compact_boundary") void this.reportContext(running)
        if (message.type === "result") {
          // A steered message that missed the turn starts the next one, so the tab stays busy.
          if (this.steering) {
            this.stopping = false
            clearTimeout(this.unresponsive)
            this.steering = false
            continue
          }
          this.endTurn()
          void this.reportContext(running)
          if (this.resumeAt) {
            this.resumeAt = undefined
            this.options.onResumedAt?.()
          }
        }
      }
    } catch (error) {
      this.fail(error)
    }
  }

  /** Ends the session after an error, which shows in the thread. The next message starts it again. */
  private fail(error: unknown) {
    this.running = false
    this.steering = false
    this.stopping = false
    clearTimeout(this.unresponsive)
    this.emit({ kind: "item", item: { type: "error", id: `error-${Date.now()}`, message: error instanceof Error ? error.message : String(error) } })
    this.emit({ kind: "status", busy: false })
    this.inbox.close()
    this.query = undefined
    this.started = false
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

  /**
   * A request shows as its own item until it is answered. Its id differs from the tool call's, which
   * shows separately. An AskUserQuestion call asks its questions, and any other tool asks for approval.
   */
  private askPermission: CanUseTool = (tool, input, options) =>
    new Promise((resolve) => {
      const item = tool === ASK_USER_QUESTION ? questionItem(input, options.toolUseID) : permissionItem(tool, input, options)
      const request = { item, tool, input, suggestions: options.suggestions, resolve }
      this.requests.set(item.requestId, request)
      // An interrupted turn cancels its request.
      options.signal.addEventListener("abort", () => this.respond(request, { behavior: "deny", message: "The request was cancelled." }))
      this.emit({ kind: "item", item })
    })

  /** Closes a request once, so its item leaves the thread, and gives Claude Code its result. */
  private respond(request: OpenRequest, result: PermissionResult) {
    if (this.requests.get(request.item.requestId) !== request) return
    this.requests.delete(request.item.requestId)
    this.emit({ kind: "item", item: { ...request.item, answered: true } })
    request.resolve(result)
  }
}

/** How long a stop may take before the tab offers Force stop, as in T3 Code. */
const UNRESPONSIVE_AFTER_MS = 15_000

/**
 * An event of a turn the user is stopping. Its result says it was stopped, so the thread can tell it from
 * one that finished. A compaction that fails because of the stop was stopped, not failed.
 */
function stoppedEvent(event: ThreadEvent): ThreadEvent {
  if (event.kind !== "item") return event
  if (event.item.type === "result") return { ...event, item: { ...event.item, stopped: true } }
  if (event.item.type === "compaction" && event.item.status === "failed") return { ...event, item: { type: "compaction", id: event.item.id, status: "stopped" } }
  return event
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
