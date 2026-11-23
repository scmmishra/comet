import { query, type CanUseTool, type PermissionResult, type Query, type SDKMessage, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { UUID } from "node:crypto"
import type { ImageAttachment, PermissionAnswer, RunSettings, ThreadEvent, ThreadItem } from "@comet/protocol"
import { SERVER_NAME } from "../../delegate/tools"
import type { AgentHost, AgentSession, Emit, SessionOptions, ToolServer } from "../agent"
import { Requests, type OpenRequest } from "../requests"
import { Stop } from "../stopping"
import { errorMessage } from "../../errors"
import { errorItem, forcedStop, userItem } from "../turn-items"
import { readContext } from "./context"
import { sdkEffort, sdkModel } from "./models"
import { BackgroundTasks } from "./background-tasks"
import { claudeCodePath } from "./executable"
import { Subagents } from "./subagents"
import { ASK_USER_QUESTION, permissionItem, permissionResult, questionItem, questionResult } from "./requests"
import { COMET_TOOL, toolStep } from "./steps"
import { ThreadMapper } from "./thread"

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

/** What a Claude session needs beyond any agent's: where its rate-limit updates go, and the idle-compaction setting. */
export interface ClaudeSessionOptions extends SessionOptions, Pick<AgentHost, "compactIdle"> {
  /** Called with each plan rate-limit update Claude sends during a turn. */
  readonly onRateLimit: (info: SDKRateLimitInfo) => void
}

type RequestSuggestions = Parameters<CanUseTool>[2]["suggestions"]
type UserItem = Extract<ThreadItem, { type: "user" }>

/**
 * How Claude Code answers a resume whose conversation is gone, in a result's errors or in its exit error,
 * after T3 Code. The session cannot come back, so the next message starts a new one.
 */
const CONVERSATION_NOT_FOUND = "No conversation found with session ID:"
const CONVERSATION_LOST = "Claude Code could not find the earlier conversation. Your next message starts a new conversation in this tab."
const SUBAGENTS_LOST = "Claude Code exited before its subagents finished."
/** Claude Code's tools that move a session into a worktree and back out. */
const WORKTREE_TOOLS = new Set(["EnterWorktree", "ExitWorktree"])

/** A request waiting for the user, with what Claude asked. */
interface ClaudeRequest extends OpenRequest<PermissionResult> {
  readonly tool: string
  readonly input: Record<string, unknown>
  readonly suggestions: RequestSuggestions
}

/** One Claude conversation. It starts on the first message. */
export class ClaudeSession implements AgentSession {
  /** Each query reads its own inbox. A failed query's input loop may still wait on its inbox, and must not take the next message. */
  private inbox?: Inbox
  private query?: Query
  private mapper: ThreadMapper
  private subagents: Subagents
  private backgroundTasks: BackgroundTasks
  private requests: Requests<PermissionResult, ClaudeRequest>
  private sessionId?: string
  /** The stop the user asked for, while its turn winds down, until its result arrives. */
  private stop: Stop
  private running = false
  /** Set from the first message, while Claude Code is found and started, until the session fails. */
  private started = false
  /** Set once the window closes the session. Closing ends Claude Code's stream, which is no failure. */
  private closed = false
  /** Set from a steered message until Claude Code takes it in, or its turn ends without it. */
  private steering = false
  /** The steered messages Claude Code has not taken in yet, by uuid. It holds one behind a running foreground tool. */
  private waitingSteers = new Map<string, UserItem>()
  /** The steered messages Claude Code exited without reading. The next message sends them first. */
  private unreadSteers: UserItem[] = []
  private settings: RunSettings
  /** Where the next query resumes, until a turn has run there. Later queries resume at the end, as usual. */
  private resumeAt?: string
  /** The title a `/rename` gave the session, until the command's result applies it. */
  private renamedTo?: string
  /** EnterWorktree and ExitWorktree calls waiting for their results. */
  private readonly worktreeCalls = new Set<string>()
  /** Set once Claude Code said the conversation to resume is gone, so the failure that follows adds no second error. */
  private lost = false

  constructor(
    private readonly dir: string,
    private readonly emit: Emit,
    private readonly options: ClaudeSessionOptions,
    private readonly runQuery: typeof query = query,
  ) {
    this.sessionId = options.resume
    this.resumeAt = options.resumeAt
    this.settings = options.settings
    this.mapper = new ThreadMapper(dir)
    this.stop = new Stop(emit)
    this.requests = new Requests(emit)
    this.subagents = new Subagents(dir, emit)
    this.backgroundTasks = new BackgroundTasks(emit)
  }

  async configure(settings: RunSettings) {
    this.settings = settings
    if (!this.query) return
    await this.query.setModel(sdkModel(settings.model))
    // null drops a flag, so the model's default effort, or standard speed, applies again.
    await this.query.applyFlagSettings({ effortLevel: settings.effort ? sdkEffort(settings.effort) : null, fastMode: settings.fast || null })
    await this.query.setPermissionMode(settings.permissionMode)
  }

  get busy() {
    return this.running
  }

  send(text: string, images: readonly ImageAttachment[] = []) {
    // Claude Code keeps the message's uuid in the transcript, so the item has the same id live and restored.
    const uuid = crypto.randomUUID()
    this.emit({ kind: "item", item: userItem(uuid, text, images) })
    this.running = true
    this.emit({ kind: "status", busy: true })
    if (!this.started) void this.start()
    this.sendUnreadSteers()
    this.inbox!.push(userMessage(uuid, text, images))
  }

  /**
   * Sends a message into the running turn. Claude Code cuts the turn's current step short, reports that
   * step's end as an aborted result, and goes on with the message. A turn that ends before the message
   * lands takes it as its next turn instead.
   */
  steer(text: string, images: readonly ImageAttachment[] = []) {
    if (!this.running) return this.send(text, images)
    const uuid = crypto.randomUUID()
    const item = { ...userItem(uuid, text, images, true), waiting: true }
    this.waitingSteers.set(uuid, item)
    this.emit({ kind: "item", item })
    this.steering = true
    this.inbox!.push({ ...userMessage(uuid, text, images), priority: "now" })
  }

  /** Claude Code reports each command as stopped once it ends. */
  async stopTasks(ids: readonly string[]) {
    await Promise.all(ids.map((id) => this.query?.stopTask(id)))
  }

  async interrupt() {
    if (!this.query || !this.stop.begin()) return
    await this.query.interrupt()
  }

  /** After a forced stop, the window closes the session, which ends Claude Code. The next message starts a new one on the same thread. */
  forceStop(): boolean {
    if (!this.stop.pending) return false
    this.settleOpen("stopped")
    this.emit({ kind: "item", item: forcedStop() })
    this.endTurn()
    return true
  }

  private endTurn() {
    this.stop.clear()
    this.running = false
    this.emit({ kind: "status", busy: false })
  }

  close() {
    this.closed = true
    this.stop.clear()
    this.requests.settleAll(() => ({ behavior: "deny", message: "The session was closed." }))
    this.endWork()
    this.inbox?.close()
    this.query?.close()
  }

  /**
   * Restores the files Claude's tools changed from `messageId` on, from the copies Claude Code kept. A
   * session that has not started opens Claude Code without a message, so nothing reaches the model.
   * Changes made another way, such as through Bash, stay.
   */
  async restoreFiles(messageId: string) {
    if (!this.started) await this.start()
    if (!this.query) throw new Error("Claude Code did not start, so Comet could not restore the files.")
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
  private answer(requestId: string, type: ClaudeRequest["item"]["type"], result: (input: Record<string, unknown>, tool: string, suggestions: RequestSuggestions) => PermissionResult) {
    const request = this.requests.get(requestId)
    if (request?.item.type !== type) return
    this.requests.settle(request, result(request.input, request.tool, request.suggestions))
  }

  /**
   * Starts Claude Code on a new inbox. It is marked started before it finds Claude Code, so a message sent
   * meanwhile joins this inbox rather than opening a second session.
   */
  private async start() {
    this.started = true
    this.lost = false
    const inbox = (this.inbox = new Inbox())
    let executable: string
    try {
      executable = await claudeCodePath()
    } catch (error) {
      return this.fail(error)
    }
    this.query = this.runQuery({
      prompt: inbox,
      options: {
        pathToClaudeCodeExecutable: executable,
        cwd: this.dir,
        includePartialMessages: true,
        // A subagent's text and thinking reach Comet too, with a one-line status, for its card.
        forwardSubagentText: true,
        agentProgressSummaries: true,
        systemPrompt: { type: "preset", preset: "claude_code", ...(this.options.tools ? { append: this.options.tools.instructions } : {}) },
        ...(this.options.tools ? { mcpServers: toolServers(this.options.tools), allowedTools: [`${COMET_TOOL}*`] } : {}),
        canUseTool: this.askPermission,
        model: sdkModel(this.settings.model),
        ...(this.settings.effort ? { effort: sdkEffort(this.settings.effort) } : {}),
        ...(this.settings.fast ? { settings: { fastMode: true } } : {}),
        permissionMode: this.settings.permissionMode,
        // Full access needs this at start. Passing it always lets a thread switch to Full access later.
        // It allows the mode and does not set it.
        allowDangerouslySkipPermissions: true,
        ...(this.options.ephemeral ? { persistSession: false } : {}),
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        ...(this.sessionId && this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}),
        // Claude Code keeps a copy of each file before its tools edit it, so a rewind can restore them.
        enableFileCheckpointing: true,
        // Claude Code asks whether to compact a large thread that sat idle. The setting answers, so no dialog shows.
        supportedDialogKinds: ["resume_return"],
        onUserDialog: async (request) =>
          request.dialogKind === "resume_return" ? { behavior: "completed", result: this.options.compactIdle() ? "compact" : "continue" } : { behavior: "cancelled" },
        // Comet cannot show an MCP elicitation, so the user made no choice. MCP keeps "decline" for an explicit no.
        onElicitation: async () => ({ action: "cancel" }),
      },
    })
    void this.pump(this.query)
  }

  private async pump(running: Query) {
    try {
      for await (const message of running) {
        // A session Claude Code could not find stays dropped, whatever id the rest of its frames carry.
        if (message.session_id && message.session_id !== this.sessionId && !this.lost) {
          this.sessionId = message.session_id
          this.options.onSessionId(message.session_id)
        }
        if (message.type === "rate_limit_event") this.options.onRateLimit(message.rate_limit_info)
        if (message.type === "result" && message.subtype !== "success" && message.errors.some((error) => error.startsWith(CONVERSATION_NOT_FOUND))) this.forget()
        this.markSteersTaken(message)
        this.followRename(message)
        this.followWorktree(message)
        this.subagents.handle(message)
        this.backgroundTasks.handle(message)
        const steer = message.type === "result" ? this.takeSteer(message) : undefined
        if (steer === "cut") {
          const reply = message.type === "result" && message.terminal_reason === "aborted_streaming" ? this.mapper.interruptedReply(Date.now()) : undefined
          if (reply) this.emit({ kind: "item", item: reply })
          continue
        }
        for (const event of this.mapper.map(message, Date.now(), !this.running)) {
          // A turn Claude Code starts itself, after a background task, makes the tab busy again.
          if (event.kind === "status" && event.busy) this.running = true
          this.emit(this.stop.pending ? stoppedEvent(event) : event)
        }
        // A compaction changes how much of the context is used.
        if (message.type === "system" && message.subtype === "compact_boundary") void this.reportContext(running)
        if (message.type === "result") {
          if (steer === "missed") {
            this.stop.clear()
            this.moveMissedSteers()
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
      this.streamEnded(running)
    } catch (error) {
      this.fail(error)
    }
  }

  /**
   * Claude Code ended its stream without an error, so its process is gone, after T3 Code. A turn it was
   * running would stay busy, and the next message would go to an inbox nothing reads, so the session lets
   * the query go and the next message starts Claude Code again.
   */
  private streamEnded(running: Query) {
    if (this.closed || this.query !== running) return
    if (this.running) return this.fail(new Error("Claude Code exited before it finished the turn."))
    // Its background subagents end with it, and no turn of its own will report them, so the thread says why.
    if (this.subagents.running) this.emit({ kind: "item", item: errorItem(new Error(SUBAGENTS_LOST)) })
    this.release()
  }

  /**
   * Ends the session after an error, which shows in the thread. The next message starts it again. A failure
   * after Claude Code said the conversation is gone adds no error of its own, since the thread already says why.
   */
  private fail(error: unknown) {
    this.steering = false
    this.requests.settleAll(() => ({ behavior: "deny", message: "The session failed." }))
    this.settleOpen(this.stop.pending ? "stopped" : "failed")
    if (!this.lost && errorMessage(error).includes(CONVERSATION_NOT_FOUND)) this.forget()
    else if (!this.lost) this.emit({ kind: "item", item: errorItem(error) })
    this.keepUnreadSteers()
    this.endTurn()
    this.release()
  }

  /** Shows each tool call the turn left without a result as unfinished, so none shows as running once the turn is over. */
  private settleOpen(end: "failed" | "stopped") {
    for (const item of this.mapper.settleOpen(end)) this.emit({ kind: "item", item })
  }

  /**
   * Drops a session Claude Code could not find to resume, after T3 Code. Resuming it again would fail every
   * message, so the next message starts a new Claude session in this tab, and the tab forgets the old one.
   */
  private forget() {
    if (this.lost) return
    this.lost = true
    this.sessionId = undefined
    this.resumeAt = undefined
    this.options.onSessionLost?.()
    this.emit({ kind: "item", item: errorItem(new Error(CONVERSATION_LOST)) })
  }

  /** Lets the query go, so the next message starts Claude Code again. */
  private release() {
    this.endWork()
    this.inbox?.close()
    this.query = undefined
    this.started = false
  }

  /**
   * What a result means for a steered message that waits. A result that only ends the step the message
   * cut short is not the turn's, and the turn goes on with the message. Any other result came before the
   * message landed, so the message starts the next turn and the tab stays busy.
   */
  private takeSteer(result: Extract<SDKMessage, { type: "result" }>): "cut" | "missed" | undefined {
    if (!this.steering) return undefined
    this.steering = false
    const cut = result.terminal_reason === "aborted_streaming" || result.terminal_reason === "aborted_tools"
    return cut && !this.stop.pending ? "cut" : "missed"
  }

  /**
   * Shows each steered message Claude Code has taken in as no longer waiting, after T3 Code. Each frame of a turn
   * names the messages the turn has read so far, so the first frame that names a steer shows it was taken.
   */
  private markSteersTaken(message: SDKMessage) {
    if (!this.waitingSteers.size) return
    for (const uuid of echoedUuids(message)) {
      const item = this.waitingSteers.get(uuid)
      if (!item) continue
      this.waitingSteers.delete(uuid)
      const { waiting: _, ...taken } = item
      this.emit({ kind: "item", item: taken })
    }
  }

  /**
   * Moves each steered message the turn ended without to after the turn's result, after T3 Code. Claude
   * Code starts the next turn with it, so it shows as that turn's first message, and not as a steer.
   */
  private moveMissedSteers() {
    for (const { waiting: _, ...item } of this.moveWaitingSteers()) this.emit({ kind: "item", item })
  }

  /**
   * Keeps each steered message Claude Code exited without reading, after T3 Code. It moves after the
   * failure and stays waiting. The next message sends it first, since the new Claude Code never saw it.
   * A steer that waited behind a stop goes too, as it does when Claude Code stays up.
   */
  private keepUnreadSteers() {
    for (const item of this.moveWaitingSteers()) {
      this.unreadSteers.push(item)
      this.emit({ kind: "item", item })
    }
  }

  /** Sends the steered messages Claude Code exited without reading, and shows them as no longer waiting, as a sent message is. */
  private sendUnreadSteers() {
    for (const { waiting: _, ...item } of this.unreadSteers.splice(0)) {
      this.emit({ kind: "item", item })
      // A steer's item id is the uuid Comet gave it.
      this.inbox!.push(userMessage(item.id as UUID, item.text, item.images ?? []))
    }
  }

  /** Takes the waiting steers out of the thread, to show again at its end, each as a message of its own and not a steer. */
  private moveWaitingSteers(): UserItem[] {
    const moved = [...this.waitingSteers.values()].map(({ steered: _, ...item }) => item)
    this.waitingSteers.clear()
    if (moved.length) this.emit({ kind: "items.remove", ids: moved.map((item) => item.id) })
    return moved
  }

  /**
   * Reports the folder the session moved to after Claude Code's EnterWorktree or ExitWorktree. Each tool's
   * result names the worktree, and ExitWorktree's also names the folder the session went back to.
   */
  private followWorktree(message: SDKMessage) {
    if ((message.type !== "assistant" && message.type !== "user") || message.parent_tool_use_id || typeof message.message.content === "string") return
    for (const block of message.message.content) {
      // A subagent's result names a worktree too, so only these two tools' calls count.
      if (block.type === "tool_use" && WORKTREE_TOOLS.has(block.name)) this.worktreeCalls.add(block.id)
      if (block.type !== "tool_result" || !this.worktreeCalls.delete(block.tool_use_id) || block.is_error) continue
      const result = (message as { tool_use_result?: { worktreePath?: unknown; originalCwd?: unknown } }).tool_use_result
      const dir = typeof result?.originalCwd === "string" ? result.originalCwd : result?.worktreePath
      if (typeof dir === "string") this.options.onMoved?.(dir)
    }
  }

  /**
   * Reports the session's new title after a `/rename`, after T3 Code. Claude Code reports the new title, then the command's
   * result. It has already saved the title with the thread. The SDK does not type the title frame.
   */
  private followRename(message: SDKMessage) {
    const frame = message as { type: string; subtype?: string; title?: unknown; local_command?: unknown }
    if (frame.type === "system" && frame.subtype === "session_title_changed" && typeof frame.title === "string") {
      this.renamedTo = frame.title.trim() || undefined
    }
    if (frame.type === "result" && frame.local_command === "rename" && this.renamedTo) {
      this.options.onRenamed?.(this.renamedTo)
      this.renamedTo = undefined
    }
  }

  /** Claude Code's process is gone or going, and the subagents and commands it ran in the background end with it. */
  private endWork() {
    this.subagents.stopRunning()
    this.backgroundTasks.clear()
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
      this.requests.add(request)
      // An interrupted turn cancels its request.
      options.signal.addEventListener("abort", () => this.requests.settle(request, { behavior: "deny", message: "The request was cancelled." }))
    })
}

/**
 * An event of a turn the user is stopping. Its result says it was stopped, so the thread can tell it from
 * one that finished. A compaction or a tool call that fails because of the stop was stopped, not failed.
 * Claude Code marks a tool call that a stop cut off as rejected by the user, as it marks one the user
 * declined, so only the stop tells them apart.
 */
function stoppedEvent(event: ThreadEvent): ThreadEvent {
  if (event.kind !== "item") return event
  const item = event.item
  if (item.type === "result") return { ...event, item: { ...item, stopped: true } }
  if (item.type === "compaction" && item.status === "failed") return { ...event, item: { type: "compaction", id: item.id, status: "stopped" } }
  if (item.type === "tool" && item.result?.isError) return { ...event, item: toolStep({ ...item, result: { ...item.result, stopped: true } }) }
  return event
}

/**
 * The uuids of the user messages a frame says its turn has read. Claude Code stamps them on a turn's init, its
 * replies and its result. The SDK types them on some frames only.
 */
function echoedUuids(message: SDKMessage): readonly string[] {
  const { user_message_uuids: uuids, user_message_uuid: uuid } = message as { user_message_uuids?: unknown; user_message_uuid?: unknown }
  if (Array.isArray(uuids)) return uuids.filter((found): found is string => typeof found === "string")
  return typeof uuid === "string" ? [uuid] : []
}

/** Comet's tools as an MCP server Claude Code connects to over HTTP. */
const toolServers = (tools: ToolServer) => ({ [SERVER_NAME]: { type: "http" as const, url: tools.url, headers: { Authorization: tools.authorization } } })

/** A message for Claude Code. Claude Code keeps its uuid in the transcript. */
const userMessage = (uuid: UUID, text: string, images: readonly ImageAttachment[]): SDKUserMessage => ({ type: "user", message: { role: "user", content: userContent(text, images) }, parent_tool_use_id: null, uuid })

/** A message's content for Claude. Images go before the text, as the API recommends. */
function userContent(text: string, images: readonly ImageAttachment[]) {
  if (!images.length) return text
  const blocks = images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } }))
  return [...blocks, ...(text ? [{ type: "text" as const, text }] : [])]
}
