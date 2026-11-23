import type { ImageAttachment, PermissionAnswer, RunSettings, ThreadItem } from "@comet/protocol"
import { SERVER_NAME } from "../../delegate/tools"
import type { AgentSession, Emit, SessionOptions, ToolServer } from "../agent"
import type { RequestId } from "../json-rpc"
import { Requests } from "../requests"
import { Stop } from "../stopping"
import { errorItem, forcedStop, userItem } from "../turn-items"
import { turnError, turnResult } from "./history"
import { userInput } from "./input"
import { changedPaths, mayStayOpen, threadItems, unfinishedItems } from "./items"
import { modelName, turnModel, type ModelCatalog } from "./models"
import { acceptsPrompts, runPolicy, threadPolicy } from "./permissions"
import type { CodexConfigRead, CodexItem, CodexModel, CodexTurn, HookCompleted, McpStartup, ReasoningSummary, TokenUsage } from "./protocol"
import { asksApproval, readRequest, type CodexRequest } from "./requests"
import type { AppServer, ThreadOwner, ThreadParams } from "./server"

/** How long Codex may take on a call to Comet's tools, in seconds. A handed-off task can run for an hour. */
const TOOL_TIMEOUT_SEC = 3900
/** How a retry notice gives its attempt, such as "Reconnecting... 2/5". */
const RETRY_PROGRESS = /\b(\d+)\s*\/\s*(\d+)\b/
/** The reasoning summary a turn asks for when Codex's config sets none. */
const DEFAULT_SUMMARY: ReasoningSummary = "auto"
/**
 * How long a turn waits for Codex to say anything after a retry before the turn fails, as in T3 Code. Codex
 * retries with no limit while it waits for the network, and T3 Code saw it announce a retry and never resume.
 * A retry that works resumes within about 75 seconds, after T3 Code.
 */
const RETRY_STALL_MS = 10 * 60_000

/**
 * A turn, from the message that opens it until it ends. Codex names it in its answer to `turn/start`.
 * A turn may wait behind another before it starts, and `started` resolves once it has, or once it
 * ended without starting.
 */
class Turn {
  id?: string
  /** The model the turn runs on, by id. */
  model?: string
  /** The turn's last retry of a failed request. */
  attempt = 0
  /** Whether the turn has given an answer, not only commentary before a tool call. */
  answered = false
  /** Why a hook stopped the turn, once one has. */
  hookStop?: string
  /** The items the turn started and has not completed, which may stay open for good, by id. */
  readonly open = new Map<string, CodexItem>()
  readonly started: Promise<string | undefined>
  private resolve!: (id: string | undefined) => void
  /** Fails the turn once Codex has said nothing for `RETRY_STALL_MS` after a retry. */
  private stall?: ReturnType<typeof setTimeout>

  constructor(readonly message: string) {
    this.started = new Promise((resolve) => (this.resolve = resolve))
  }

  start(id: string) {
    this.id = id
    this.resolve(id)
  }

  end() {
    this.resolve(undefined)
    this.progressed()
  }

  /** Codex retries a request. `stalled` runs if Codex then says nothing in time. A later retry starts the wait again. */
  retried(stalled: () => void) {
    clearTimeout(this.stall)
    this.stall = setTimeout(stalled, RETRY_STALL_MS)
  }

  /** Codex said something after a retry, so the retry has not stalled. */
  progressed() {
    clearTimeout(this.stall)
    this.stall = undefined
  }
}

/** A request waiting for the user, with what answers Codex and the request's JSON-RPC id. */
type WaitingRequest = CodexRequest & { readonly resolve: (reply: unknown) => void; readonly rpcId: RequestId }

/**
 * One Codex thread. It loads the thread into the shared app-server on its first message, and
 * claims the thread's messages there. It also claims the threads of the agents Codex starts, so their
 * requests for approval reach the tab.
 */
export class CodexSession implements AgentSession, ThreadOwner {
  private threadId?: string
  /** The thread loaded in the app-server, from the first message until the app-server ends. */
  private loading?: Promise<string>
  /** The model the thread started or resumed on, which a turn that names none runs on. */
  private threadModel?: string
  private models: readonly CodexModel[] = []
  /** Releases the thread, and the threads of Codex's own agents, from this session. */
  private releases: (() => void)[] = []
  private children = new Set<string>()
  /** The running turn, from its message until its result. */
  private turn?: Turn
  private stop: Stop
  private settings: RunSettings
  /** The model Comet last told the tab runs, by name. */
  private announced?: string
  private requests: Requests<unknown, WaitingRequest>
  /** The paths of each file change Codex reported, by item id, for the request to apply it. */
  private files = new Map<string, readonly string[]>()
  /** The MCP servers whose failure to start the thread shows, until each starts. */
  private failedServers = new Set<string>()

  constructor(
    private readonly dir: string,
    private readonly emit: Emit,
    private readonly options: SessionOptions,
    private readonly server: AppServer,
    private readonly catalog: ModelCatalog,
  ) {
    this.threadId = options.resume
    this.settings = options.settings
    this.stop = new Stop(emit)
    this.requests = new Requests(emit)
  }

  get busy() {
    return this.turn !== undefined
  }

  /** Codex takes the model, effort and permissions with each turn, so the next turn runs with these. */
  async configure(settings: RunSettings) {
    this.settings = settings
  }

  /** Comet names the message, and Codex keeps the name, so the item has the same id live and restored. */
  send(text: string, images: readonly ImageAttachment[] = []) {
    const id = crypto.randomUUID()
    this.emit({ kind: "item", item: userItem(id, text, images) })
    this.run(id, text, images)
  }

  /** The message joins the turn once the turn has started. A turn that ends before the message lands takes it as its next turn instead. */
  steer(text: string, images: readonly ImageAttachment[] = []) {
    if (!this.turn) return this.send(text, images)
    const id = crypto.randomUUID()
    this.emit({ kind: "item", item: userItem(id, text, images, true) })
    void this.steerInto(this.turn, id, text, images)
  }

  /** A turn still waiting to start is stopped once it starts, since Codex stops only a running turn. */
  async interrupt() {
    const turn = this.turn
    if (!turn || !this.stop.begin()) return
    const turnId = await turn.started
    if (turnId === undefined || this.turn !== turn || !this.threadId) return
    await this.server.request("turn/interrupt", { threadId: this.threadId, turnId })
  }

  forceStop(): boolean {
    if (!this.stop.pending) return false
    this.settleOpen("interrupted")
    this.emit({ kind: "item", item: forcedStop() })
    this.endTurn()
    return true
  }

  answerPermission(requestId: string, answer: PermissionAnswer) {
    const request = this.requests.get(requestId)
    if (request && asksApproval(request)) this.requests.settle(request, request.reply(answer))
  }

  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined) {
    const request = this.requests.get(requestId)
    if (request && !asksApproval(request)) this.requests.settle(request, request.reply(answers))
  }

  /**
   * Declines every open request and stops a running turn, since the app-server runs on after the session
   * closes. It also unsubscribes from the thread, after T3 Code, so Codex unloads it once idle. A resume of
   * a thread that is still loaded rejoins it with the config it loaded with, which holds this session's
   * token for Comet's tools. The next session's resume then loads it with its own.
   */
  close() {
    this.dismissRequests()
    const turnId = this.turn?.id
    if (turnId && this.threadId) void this.server.request("turn/interrupt", { threadId: this.threadId, turnId }).catch(() => undefined)
    if (this.loading && this.threadId) void this.server.request("thread/unsubscribe", { threadId: this.threadId }).catch(() => undefined)
    this.stop.clear()
    this.turn?.end()
    for (const release of this.releases) release()
    this.releases = []
  }

  /** A notification about the thread, or about the thread of one of Codex's own agents. */
  notify(method: string, params: ThreadParams) {
    if (params.threadId !== this.threadId) return this.notifyChild(method, params)
    // Anything Codex says about the thread, but another retry, shows it did not stall, after T3 Code.
    if (method !== "error") this.turn?.progressed()
    switch (method) {
      case "turn/started":
        return this.started((params.turn as CodexTurn).id)
      case "model/rerouted":
        return this.rerouted(String(params.toModel))
      case "item/started":
      case "item/completed":
        return this.item(params.item as CodexItem, method === "item/completed")
      case "item/agentMessage/delta":
        return this.emit({ kind: "text.delta", id: String(params.itemId), delta: String(params.delta) })
      case "thread/tokenUsage/updated":
        return this.context(params.tokenUsage as TokenUsage)
      case "error":
        return this.retry(params as ThreadParams & { error: { message: string }; willRetry: boolean })
      case "serverRequest/resolved":
        return this.settled(params.requestId as RequestId)
      case "mcpServer/startupStatus/updated":
        return this.serverStatus(params as ThreadParams & McpStartup)
      case "hook/completed":
        return this.hookCompleted(params as ThreadParams & HookCompleted)
      case "turn/completed":
        return this.complete(params.turn as CodexTurn)
    }
  }

  request(method: string, params: ThreadParams, rpcId: RequestId): Promise<unknown> | undefined {
    const asked = readRequest(method, params, rpcId, (itemId) => this.files.get(itemId), acceptsPrompts(this.settings.permissionMode))
    if (!asked) return undefined
    if ("answer" in asked) return Promise.resolve(asked.answer)
    return new Promise((resolve) => this.requests.add({ ...asked, resolve, rpcId }))
  }

  /** A running turn fails, and the next message loads the thread again. */
  lost(error: Error) {
    this.loading = undefined
    this.releases = []
    this.children.clear()
    if (this.turn) this.fail(error)
    else this.dismissRequests()
  }

  private run(message: string, text: string, images: readonly ImageAttachment[]) {
    const turn = (this.turn = new Turn(message))
    this.emit({ kind: "status", busy: true })
    void this.startTurn(turn, text, images).catch((error) => this.turn === turn && this.fail(error))
  }

  private async startTurn(turn: Turn, text: string, images: readonly ImageAttachment[]) {
    const summary = this.reasoningSummary()
    this.models = await this.catalog.get()
    const threadId = await this.load(this.models)
    const chosen = turnModel(this.models, this.settings)
    turn.model = chosen.model ?? this.threadModel
    const { turn: started } = await this.server.request<{ turn: CodexTurn }>("turn/start", {
      threadId,
      clientUserMessageId: turn.message,
      input: userInput(text, images),
      summary: await summary,
      ...runPolicy(this.settings.permissionMode),
      ...chosen,
    })
    turn.id ??= started.id
    if (started.startedAt !== null) this.started(started.id)
  }

  /**
   * The reasoning summary the user set in Codex's config, else `auto`, after T3 Code. A turn's summary
   * replaces the config's, and some providers, such as Amazon Bedrock, refuse `detailed`. A model may
   * default to `none`, so the turn still names one.
   */
  private async reasoningSummary(): Promise<ReasoningSummary> {
    const read = await this.server.request<CodexConfigRead>("config/read", { cwd: this.dir, includeLayers: false }).catch(() => undefined)
    return read?.config.model_reasoning_summary ?? DEFAULT_SUMMARY
  }

  /** A message steered into a turn that ended first starts the next turn, or joins the one running by then. */
  private async steerInto(turn: Turn, message: string, text: string, images: readonly ImageAttachment[]) {
    const turnId = await turn.started
    try {
      if (turnId === undefined || !this.threadId) throw new Error("The turn ended before the message joined it.")
      await this.server.request("turn/steer", { threadId: this.threadId, expectedTurnId: turnId, clientUserMessageId: message, input: userInput(text, images) })
    } catch (error) {
      if (!this.turn) return this.run(message, text, images)
      if (this.turn !== turn) return void this.steerInto(this.turn, message, text, images)
      this.emit({ kind: "item", item: errorItem(error) })
    }
  }

  /** Loads the thread into the app-server: a new one, or the one the tab resumes. Comet's tools join it as an MCP server. */
  private load(models: readonly CodexModel[]): Promise<string> {
    this.loading ??= this.open(models).catch((error) => {
      this.loading = undefined
      throw error
    })
    return this.loading
  }

  private async open(models: readonly CodexModel[]): Promise<string> {
    const { model } = turnModel(models, this.settings)
    const params = { cwd: this.dir, ...threadPolicy(this.settings.permissionMode), ...(model ? { model } : {}), ...(this.options.tools ? toolServer(this.options.tools) : {}) }
    const resume = this.threadId
    // An ephemeral thread is not written to disk, so Codex neither lists nor resumes it.
    const response = await this.server.request<{ thread: { id: string }; model: string }>(
      resume ? "thread/resume" : "thread/start",
      resume ? { threadId: resume, ...params, excludeTurns: true } : { ...params, ...(this.options.ephemeral ? { ephemeral: true } : {}) },
    )
    this.threadModel = response.model
    this.releases.push(this.server.own(response.thread.id, this))
    if (response.thread.id !== resume) this.options.onSessionId(response.thread.id)
    this.threadId = response.thread.id
    return response.thread.id
  }

  /** The turn started. The tab hears which model runs it, when that changed. */
  private started(turnId: string) {
    const turn = this.turn
    if (!turn) return
    turn.start(turnId)
    if (turn.model) this.announce(turn.model)
  }

  /** Codex moved the turn to another model than the one asked for, such as for a request it flagged. The tab shows the model that runs it. */
  private rerouted(model: string) {
    if (this.turn) this.turn.model = model
    this.announce(model)
  }

  /** Tells the tab the model that runs, by name, when that changed. */
  private announce(model: string) {
    const name = modelName(this.models, model)
    if (name && name !== this.announced) {
      this.announced = name
      this.emit({ kind: "init", model: name })
    }
  }

  private item(item: CodexItem, done: boolean) {
    this.claimAgents(item)
    if (item.type === "fileChange") this.files.set(item.id, changedPaths(this.dir, item.changes))
    if (mayStayOpen(item)) {
      if (done) this.turn?.open.delete(item.id)
      else this.turn?.open.set(item.id, item)
    }
    if (done && this.turn && answers(item)) this.turn.answered = true
    for (const found of threadItems(this.dir, item, done, done ? Date.now() : undefined)) this.emit({ kind: "item", item: found })
  }

  /** An agent's thread is only watched for the agents it starts in turn, and for requests Codex settles itself. */
  private notifyChild(method: string, params: ThreadParams) {
    if (method === "item/started" || method === "item/completed") this.claimAgents(params.item as CodexItem)
    if (method === "serverRequest/resolved") this.settled(params.requestId as RequestId)
  }

  /** Claims the threads of the agents an item starts, so their requests reach this session. */
  private claimAgents(item: CodexItem) {
    const ids = item.type === "collabAgentToolCall" ? item.receiverThreadIds : item.type === "subAgentActivity" ? [item.agentThreadId] : []
    for (const id of ids) {
      if (this.children.has(id)) continue
      this.children.add(id)
      this.releases.push(this.server.own(id, this))
    }
  }

  private context(usage: TokenUsage) {
    const maxTokens = usage.modelContextWindow
    if (!maxTokens) return
    const tokens = usage.last.totalTokens
    this.emit({ kind: "context", reading: { percent: Math.min(100, (tokens / maxTokens) * 100), tokens, maxTokens } })
  }

  /**
   * Codex tries a failed request again and says so. An error it does not retry ends the turn, whose result
   * reports it. A retry without "2/5" in its text has no limit, after T3 Code: Codex drops the count once
   * it waits for the network. Its attempt counts on from the turn's last retry.
   */
  private retry({ error, willRetry }: { error: { message: string }; willRetry: boolean }) {
    const turn = this.turn
    if (!willRetry || !turn) return
    const progress = RETRY_PROGRESS.exec(error.message)
    turn.attempt = progress ? Number(progress[1]) : turn.attempt + 1
    turn.retried(() => this.stalled(turn, error.message))
    this.emit({ kind: "retry", attempt: turn.attempt, ...(progress ? { maxRetries: Number(progress[2]) } : {}), delayMs: 0, error: error.message })
  }

  /**
   * Codex said nothing for `RETRY_STALL_MS` after a retry. The turn fails with Codex's last error, and Codex
   * is asked to stop it. A stop the user asked for is left to finish, since Force stop can end it.
   */
  private stalled(turn: Turn, error: string) {
    if (this.turn !== turn || this.stop.pending) return
    if (turn.id && this.threadId) void this.server.request("turn/interrupt", { threadId: this.threadId, turnId: turn.id }).catch(() => undefined)
    this.fail(new Error(`Codex did not recover from a failed request in ${RETRY_STALL_MS / 60_000} minutes, so the turn was stopped. Codex said: ${error}`))
  }

  /** Codex settled a request itself, such as when its reviewer answered. The request leaves the thread. */
  private settled(rpcId: RequestId) {
    const request = this.requests.find((found) => found.rpcId === rpcId)
    if (request) this.requests.settle(request, request.dismissed)
  }

  /** The turn ended. Requests it left open are over, a failed turn shows its error, and its result closes it. */
  private complete(ended: CodexTurn) {
    const turn = this.turn
    if (!turn || (turn.id !== undefined && turn.id !== ended.id)) return
    this.dismissRequests()
    this.settleOpen(ended.status)
    if (turn.hookStop) this.emit({ kind: "item", item: hookStopItem(ended.id, turn.hookStop, turn.answered) })
    if (ended.status === "failed") this.emit({ kind: "item", item: turnError(ended) })
    this.emit({ kind: "item", item: turnResult(ended, turn.message, this.stop.pending) })
    this.endTurn()
  }

  /**
   * An MCP server that failed to start shows as a warning, with Codex's reason, after T3 Code. Codex starts
   * the servers each time it loads the thread, and may try a server again, so a server warns once until it starts.
   */
  private serverStatus({ name, status, error }: McpStartup) {
    if (status === "ready") return void this.failedServers.delete(name)
    if (status !== "failed" || this.failedServers.has(name)) return
    this.failedServers.add(name)
    const text = error?.trim() ? `MCP server ${name} did not start.\n${error.trim()}` : `MCP server ${name} did not start.`
    this.emit({ kind: "item", item: { type: "notice", id: `mcp-failed:${crypto.randomUUID()}`, text, warning: true } })
  }

  /**
   * A hook that stops the turn leaves its reason, after T3 Code. Codex then reports the turn as completed,
   * so the reason shows when the turn ends. Codex keeps no trace of it in the thread's history.
   */
  private hookCompleted({ turnId, run }: HookCompleted) {
    const turn = this.turn
    if (!turn || turnId === null || turn.id !== turnId || run.status !== "stopped") return
    const reason = run.entries.flatMap((entry) => (entry.kind === "stop" && entry.text.trim() ? [entry.text.trim()] : [])).join("\n")
    const text = reason ? `The ${run.eventName} hook stopped the turn.\n${reason}` : `The ${run.eventName} hook stopped the turn.`
    turn.hookStop = turn.hookStop ? `${turn.hookStop}\n${text}` : text
  }

  private endTurn() {
    this.stop.clear()
    this.turn?.end()
    this.turn = undefined
    this.emit({ kind: "status", busy: false })
  }

  private fail(error: unknown) {
    this.dismissRequests()
    this.settleOpen("failed")
    this.emit({ kind: "item", item: errorItem(error) })
    this.endTurn()
  }

  /** Shows each item the turn left open as unfinished, so none shows as running once the turn is over. */
  private settleOpen(status: CodexTurn["status"]) {
    for (const open of this.turn?.open.values() ?? []) for (const item of unfinishedItems(this.dir, open, status)) this.emit({ kind: "item", item })
    this.turn?.open.clear()
  }

  private dismissRequests() {
    this.requests.settleAll((request) => request.dismissed)
  }
}

/** Whether an item answers the user. Codex marks the messages it writes before a tool call as commentary. */
const answers = (item: CodexItem) => item.type === "agentMessage" && item.phase !== "commentary" && item.text.trim() !== ""

/**
 * Why a hook stopped the turn. A turn with no answer shows it as an error, so a task handed to Codex reads
 * as failed with the hook's reason. A turn that answered first shows it as a warning, and keeps its answer.
 */
function hookStopItem(turnId: string, reason: string, answered: boolean): ThreadItem {
  const id = `hook-stop:${turnId}`
  return answered ? { type: "notice", id, text: reason, warning: true } : { type: "error", id, message: reason }
}

/** Comet's tools as an MCP server Codex connects to over HTTP, with what to tell the model about them. */
const toolServer = (tools: ToolServer) => ({
  config: { [`mcp_servers.${SERVER_NAME}`]: { url: tools.url, http_headers: { Authorization: tools.authorization }, tool_timeout_sec: TOOL_TIMEOUT_SEC } },
  developerInstructions: tools.instructions,
})
