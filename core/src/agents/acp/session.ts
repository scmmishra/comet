import { DEFAULT_MODEL, type ImageAttachment, type PermissionAnswer, type RunSettings } from "@desk/protocol"
import { SERVER_NAME } from "../../delegate/tools"
import type { AgentSession, Emit, SessionOptions, ToolServer } from "../agent"
import { RpcError } from "../json-rpc"
import type { Process } from "../process"
import { Requests, type OpenRequest } from "../requests"
import { Stop } from "../stopping"
import { errorItem, resultId, userItem } from "../turn-items"
import { choices, currentName, modelOption, thoughtOption } from "./config-options"
import { AcpConnection } from "./connection"
import type { AcpFlavor } from "./flavor"
import { CANCELLED, permissionItem, permissionResponse, questionItem, questionResponse } from "./permissions"
import { promptContent, takesInstructions } from "./prompt"
import { AUTH_REQUIRED, type ConfigOption, type McpServer, type PermissionRequest, type PermissionResponse, type SessionNotification, type StopReason } from "./protocol"
import type { AcpThreadStore, ThreadRecord } from "./thread-record"
import { UpdateMapper } from "./updates"

/** Stop reasons that mean the turn did not finish its work, with the sentence that tells the user why. */
const UNFINISHED_STOPS: Partial<Record<StopReason, string>> = {
  refusal: "The agent refused this request. Its next turn won't include this message or its reply.",
  max_tokens: "The agent stopped because its reply reached the output token limit.",
  max_turn_requests: "The agent stopped because it reached its request limit for this turn.",
}

/** A running agent process with its session open. */
interface Live {
  readonly connection: AcpConnection
  readonly sessionId: string
  mode?: string
}

/** A request waiting for the user, with what the agent asked. */
interface AcpRequest extends OpenRequest<PermissionResponse> {
  readonly request: PermissionRequest
}

/**
 * One conversation with an ACP agent. ACP runs one agent process per connection, so each
 * session starts its own process on its first message and ends it on close. A process that ends between
 * turns is started again by the next message, which resumes the session.
 */
export class AcpSession implements AgentSession {
  private readonly emit: Emit
  private readonly mapper: UpdateMapper
  /** Absent for an ephemeral session, which leaves no saved thread. */
  private readonly record?: ThreadRecord
  private readonly stop: Stop
  private readonly requests: Requests<PermissionResponse, AcpRequest>
  private settings: RunSettings
  /** The session's settings as the agent last reported them. */
  private configOptions: readonly ConfigOption[] = []
  private sessionId?: string
  /** The process of the latest start. */
  private process?: Process
  private starting?: Promise<Live>
  private live?: Live
  /** The running turn, from its message until its result. */
  private turn?: { readonly id: string; readonly start: number }
  /** Set for a new session until a prompt has carried the tools' instructions. */
  private instruct: boolean
  /** Set when the agent printed that it waits for a sign-in, until the turn has failed with it. */
  private signInNeeded = false

  constructor(
    private readonly dir: string,
    emit: Emit,
    private readonly options: SessionOptions,
    private readonly flavor: AcpFlavor,
    threads: AcpThreadStore,
  ) {
    if (!options.ephemeral) this.record = threads.record(dir, options.resume)
    // Every item the tab sees is kept, so the thread can be read back later.
    this.emit = (event) => {
      if (event.kind === "item") this.record?.add(event.item)
      emit(event)
    }
    this.mapper = new UpdateMapper(dir, flavor.tools)
    this.stop = new Stop(this.emit)
    this.requests = new Requests(this.emit)
    this.sessionId = options.resume
    this.settings = options.settings
    this.instruct = !options.resume && !!options.tools
  }

  get busy() {
    return this.turn !== undefined
  }

  send(text: string, images: readonly ImageAttachment[] = []) {
    const turn = { id: crypto.randomUUID(), start: Date.now() }
    this.emit({ kind: "item", item: userItem(turn.id, text, images) })
    this.turn = turn
    this.emit({ kind: "status", busy: true })
    void this.run(turn, text, images)
  }

  /** Asks the agent to cancel the turn. Its prompt then answers, and the turn ends as stopped. */
  async interrupt() {
    if (!this.turn || !this.stop.begin()) return
    // ACP asks the client to answer every open request as cancelled.
    this.cancelRequests()
    if (this.live) this.live.connection.cancel(this.live.sessionId)
  }

  /** Ends a turn the agent did not stop when asked, as stopped. The window then closes the session, which ends the process. */
  forceStop(): boolean {
    if (!this.stop.pending || !this.turn) return false
    this.endTurn(this.turn, { isError: false, stopped: true })
    return true
  }

  async configure(settings: RunSettings) {
    this.settings = settings
    if (this.live) await this.apply(this.live)
  }

  answerPermission(requestId: string, answer: PermissionAnswer) {
    const open = this.requests.get(requestId)
    if (open?.item.type !== "permission") return
    this.requests.settle(open, permissionResponse(open.request, answer))
    // Cancel also stops the turn, as it does for every agent.
    if (answer === "cancel") void this.interrupt()
  }

  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined) {
    const open = this.requests.get(requestId)
    if (open?.item.type === "question") this.requests.settle(open, questionResponse(open.request, answers))
  }

  close() {
    this.stop.clear()
    this.turn = undefined
    this.cancelRequests()
    this.process?.close()
  }

  private async run(turn: NonNullable<AcpSession["turn"]>, text: string, images: readonly ImageAttachment[]) {
    try {
      const live = await this.connect()
      // A stop asked while the agent started cancels the turn before its prompt.
      if (this.stop.pending) return this.finish(turn, "cancelled")
      this.finish(turn, await live.connection.prompt(live.sessionId, this.prompt(text, images)))
    } catch (error) {
      this.fail(turn, error)
    }
  }

  /** The tools' instructions go with the first message of a new session that can carry them. */
  private prompt(text: string, images: readonly ImageAttachment[]) {
    const instructions = this.instruct && takesInstructions(text) ? this.options.tools?.instructions : undefined
    if (instructions) this.instruct = false
    return promptContent(text, images, instructions)
  }

  /** The live session, started once however many messages wait for it. A failed start is tried again by the next message. */
  private connect(): Promise<Live> {
    this.starting ??= this.start().catch((error) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  private async start(): Promise<Live> {
    const process = this.flavor.launch(this.dir)
    this.process = process
    const connection = await AcpConnection.open(
      process,
      {
        update: this.update,
        permission: this.ask,
        closed: () => this.ended(process),
        stray: (line) => {
          // The agent waits for a browser sign-in it cannot finish in a session, so the turn fails instead.
          if (!this.flavor.needsSignIn?.(line)) return
          this.signInNeeded = true
          process.close()
        },
      },
      this.flavor.connect,
    )
    try {
      const params = { cwd: this.dir, mcpServers: toolServers(this.options.tools) }
      const opened = !this.sessionId
      const setup = this.sessionId ? await connection.resumeSession(this.sessionId, params) : await connection.newSession(params)
      if (!this.sessionId) {
        if (!setup.sessionId) throw new Error("The agent opened a session without an id.")
        this.sessionId = setup.sessionId
        this.record?.name(setup.sessionId)
        this.options.onSessionId(setup.sessionId)
      }
      const live: Live = { connection, sessionId: this.sessionId, ...(setup.modes ? { mode: setup.modes.currentModeId } : {}) }
      this.take(setup.configOptions ?? [], opened)
      await this.apply(live)
      this.live = live
      return live
    } catch (error) {
      connection.close()
      throw error
    }
  }

  /** The process ended. Requests it made can no longer be answered, and the next message starts it again. */
  private ended(process: Process) {
    if (this.process !== process) return
    this.live = undefined
    this.starting = undefined
    this.cancelRequests()
  }

  /** Puts the session in the tab's mode, model and thinking level, where they differ from what it runs. */
  private async apply(live: Live) {
    const mode = this.flavor.modeId(this.settings.permissionMode)
    if (mode !== live.mode) {
      await live.connection.setMode(live.sessionId, mode)
      live.mode = mode
    }
    const model = modelOption(this.configOptions)
    if (model && this.settings.model !== DEFAULT_MODEL && model.currentValue !== this.settings.model) await this.setOption(live, model.id, this.settings.model)
    // The thinking levels are the chosen model's, so they are read after the model is set.
    const thought = thoughtOption(this.configOptions)
    const effort = this.settings.effort
    if (thought && effort && thought.currentValue !== effort && choices(thought).some((choice) => choice.value === effort)) await this.setOption(live, thought.id, effort)
  }

  private async setOption(live: Live, configId: string, value: string) {
    const options = await live.connection.setConfigOption(live.sessionId, configId, value)
    if (options) this.take(options)
  }

  /** Keeps the session's settings as the agent reports them, and names the model that runs. */
  private take(options: readonly ConfigOption[], opened = false) {
    this.configOptions = options
    this.flavor.learn(options, opened)
    const model = modelOption(options)
    const name = model && currentName(model)
    if (name) this.emit({ kind: "init", model: name })
  }

  private update = ({ update }: SessionNotification) => {
    if (update.sessionUpdate === "config_option_update") return this.take(update.configOptions)
    for (const event of this.mapper.map(update, Date.now())) this.emit(event)
  }

  /** A request shows as its own item until it is answered. Its id is the tool call's, which shows separately. */
  private ask = (request: PermissionRequest) =>
    new Promise<PermissionResponse>((resolve) => {
      const item = this.flavor.isQuestion?.(request) ? questionItem(request) : permissionItem(request, this.flavor.tools)
      this.requests.add({ item, request, resolve })
    })

  private cancelRequests() {
    this.requests.settleAll(() => CANCELLED)
  }

  private finish(turn: NonNullable<AcpSession["turn"]>, stopReason: StopReason) {
    if (this.turn !== turn) return
    const unfinished = UNFINISHED_STOPS[stopReason]
    if (unfinished) this.emit({ kind: "item", item: errorItem(unfinished) })
    this.endTurn(turn, { isError: unfinished !== undefined, stopped: stopReason === "cancelled" || this.stop.pending })
  }

  /**
   * Ends the turn after an error, which shows in the thread. A sign-in the agent needs signs the account out.
   * Tool calls left open end as unfinished. An agent that answered with an error is still alive, so only the
   * calls it never started end. Any other error means its process is gone, or Desk closed it.
   */
  private fail(turn: NonNullable<AcpSession["turn"]>, error: unknown) {
    if (this.turn !== turn) return
    const signIn = this.signInNeeded || (error instanceof RpcError && error.code === AUTH_REQUIRED)
    this.signInNeeded = false
    const shown = signIn ? this.flavor.signedOut() : error
    if (signIn) this.process?.close()
    for (const event of this.mapper.endTools(error instanceof RpcError && !signIn)) this.emit(event)
    this.emit({ kind: "item", item: errorItem(shown) })
    this.endTurn(turn)
  }

  /** Finishes the text being written, adds the result when there is one, and saves the thread. */
  private endTurn(turn: NonNullable<AcpSession["turn"]>, result?: { readonly isError: boolean; readonly stopped: boolean }) {
    const now = Date.now()
    for (const event of this.mapper.finish(now)) this.emit(event)
    if (result) this.emit({ kind: "item", item: { type: "result", id: resultId(turn.id), durationMs: now - turn.start, isError: result.isError, ...(result.stopped ? { stopped: true } : {}) } })
    this.stop.clear()
    this.turn = undefined
    this.emit({ kind: "status", busy: false })
    this.record?.save()
  }
}

/** Desk's tools as an MCP server the agent connects to over HTTP. */
const toolServers = (tools: ToolServer | undefined): McpServer[] =>
  tools ? [{ type: "http", name: SERVER_NAME, url: tools.url, headers: [{ name: "Authorization", value: tools.authorization }] }] : []

