import { DEFAULT_MODEL, type ImageAttachment, type PermissionAnswer, type RunSettings } from "@comet/protocol"
import { SERVER_NAME } from "../../tools/mcp"
import type { AgentSession, Emit, SessionOptions, ToolServer } from "../agent"
import { RpcError } from "../json-rpc"
import type { Process } from "../process"
import { Requests, type OpenRequest } from "../requests"
import { Stop } from "../stopping"
import { errorItem, resultId, selfStartedItem, userItem } from "../turn-items"
import { AfterPrompt, opensTurn } from "./after-prompt"
import { choices, currentName, modelOption, thoughtOption } from "./config-options"
import { AcpConnection, StartTimeout } from "./connection"
import type { AcpFlavor, PromptCheck, PromptFailure } from "./flavor"
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

/** The opener of a turn the agent started itself. */
const SELF_STARTED = "The agent started a turn on its own."

/** A running agent process with its session open. */
interface Live {
  readonly connection: AcpConnection
  readonly sessionId: string
  mode?: string
}

/** A turn, from its message until its result. */
interface Turn {
  readonly id: string
  readonly start: number
  /** Set while the turn's prompt waits for its answer. A turn the agent started itself has no prompt. */
  prompting: boolean
  /** What keeps the turn open after its prompt, for an agent that works past it. */
  readonly after?: AfterPrompt
  /** Checks the turn once it ends after its prompt. */
  check?: PromptCheck
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
  private turn?: Turn
  /** For an agent that works past its prompt: checks the turn it may start itself, read when the last turn ended. */
  private nextCheck?: PromptCheck
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
      if (event.kind === "items.remove") this.record?.remove(event.ids)
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
    const turn = this.open(crypto.randomUUID(), true)
    this.emit({ kind: "item", item: userItem(turn.id, text, images) })
    this.turn = turn
    this.emit({ kind: "status", busy: true })
    void this.run(turn, text, images)
  }

  /**
   * Asks the agent to cancel the turn. Its prompt then answers, and the turn ends as stopped. A turn that
   * went on after its prompt has no prompt to answer, so it ends as stopped once the agent is quiet. A turn
   * whose agent is still starting has no session to cancel, so its process ends, and the turn ends as stopped.
   */
  async interrupt() {
    const turn = this.turn
    if (!turn || !this.stop.begin()) return
    // ACP asks the client to answer every open request as cancelled.
    this.cancelRequests()
    if (this.live) this.live.connection.cancel(this.live.sessionId)
    else if (turn.prompting) this.process?.close()
    this.wait(turn)
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
    else this.answered()
  }

  answerQuestion(requestId: string, answers: Readonly<Record<string, string>> | undefined) {
    const open = this.requests.get(requestId)
    if (open?.item.type !== "question") return
    this.requests.settle(open, questionResponse(open.request, answers))
    this.answered()
  }

  close() {
    this.stop.clear()
    this.turn?.after?.clear()
    this.turn = undefined
    this.cancelRequests()
    this.process?.close()
  }

  /** A new turn. For an agent that works past its prompt, the turn follows that work. */
  private open(id: string, prompting: boolean): Turn {
    const work = this.flavor.background
    return { id, start: Date.now(), prompting, ...(work ? { after: new AfterPrompt(work, (callId) => this.mapper.call(callId)) } : {}) }
  }

  /** Opens a turn the agent started itself, such as when a command it ran past its prompt ended. */
  private selfStart() {
    const opener = selfStartedItem(crypto.randomUUID(), SELF_STARTED, Date.now())
    const turn = this.open(opener.id, false)
    if (this.nextCheck) turn.check = this.nextCheck
    this.emit({ kind: "item", item: opener })
    this.turn = turn
    this.emit({ kind: "status", busy: true })
  }

  private async run(turn: Turn, text: string, images: readonly ImageAttachment[]) {
    let live: Live
    try {
      live = await this.connect()
    } catch (error) {
      // A stop while the agent started ended its process, so the start failed because of the stop.
      if (this.stop.pending) return this.finish(turn, "cancelled")
      return this.fail(turn, error instanceof StartTimeout ? new Error(`${error.message} The next message starts it again.`) : error)
    }
    try {
      // A stop asked as the start finished cancels the turn before its prompt.
      if (this.stop.pending) return this.finish(turn, "cancelled")
      const check = this.flavor.watchPrompt?.(live.sessionId)
      this.finish(turn, await live.connection.prompt(live.sessionId, this.prompt(text, images)), check)
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
        closed: (error) => this.ended(process, error),
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

  /**
   * The process ended. Requests it made can no longer be answered, and the next message starts it again.
   * A turn with an open prompt fails as its prompt does. One that went on after its prompt fails here.
   */
  private ended(process: Process, error: Error) {
    if (this.process !== process) return
    this.live = undefined
    this.starting = undefined
    this.cancelRequests()
    if (this.turn && !this.turn.prompting) this.fail(this.turn, error)
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
    if (!this.turn && this.flavor.background && opensTurn(update)) this.selfStart()
    const events = this.mapper.map(update, Date.now())
    for (const event of events) this.emit(event)
    const turn = this.turn
    // A call that ends with no turn open, such as one a stop ended, is saved with the thread.
    if (!turn) return void (events.some((event) => event.kind === "item") && this.record?.save())
    turn.after?.take(update)
    this.wait(turn)
  }

  /**
   * A request shows as its own item until it is answered. Its id is the tool call's, which shows separately.
   * Comet approves a call of its own tools itself, once, in every mode: the user chose the thread's
   * permission mode, and work handed to another agent runs no broader than it. A request that offers no
   * way to allow it once waits for the user.
   */
  private ask = (request: PermissionRequest) => {
    const own = this.flavor.isCometTool?.(request) ? permissionResponse(request, "allow") : undefined
    if (own && own !== CANCELLED) return Promise.resolve(own)
    return new Promise<PermissionResponse>((resolve) => {
      if (!this.turn && this.flavor.background) this.selfStart()
      const item = this.flavor.isQuestion?.(request) ? questionItem(request) : permissionItem(request, this.flavor.tools)
      this.requests.add({ item, request, resolve })
      if (this.turn) this.wait(this.turn)
    })
  }

  /** The user answered a request, so the agent goes on with its turn. */
  private answered() {
    const turn = this.turn
    if (!turn) return
    turn.after?.answered()
    this.wait(turn)
  }

  /**
   * Waits for a turn that goes on after its prompt to end. A request that waits for the user holds the
   * turn with no limit. A stop ends it as stopped once the agent is quiet. Otherwise it ends as completed,
   * and the flavor's check may find that it failed.
   */
  private wait(turn: Turn) {
    if (this.turn !== turn || turn.prompting || !turn.after) return
    const stopping = this.stop.pending
    if (!stopping && this.requests.waiting) return turn.after.clear()
    turn.after.wait(stopping, () => this.conclude(turn, stopping, stopping ? undefined : turn.check?.()))
  }

  private cancelRequests() {
    this.requests.settleAll(() => CANCELLED)
  }

  /**
   * Ends a turn whose prompt answered. The flavor's check may find that it failed. A stopped turn is not
   * checked. A turn whose agent goes on with a call it runs past the prompt waits for that call instead.
   */
  private finish(turn: Turn, stopReason: StopReason, check?: PromptCheck) {
    if (this.turn !== turn) return
    turn.prompting = false
    const stopped = stopReason === "cancelled" || this.stop.pending
    const failure = stopped ? undefined : check?.()
    const unfinished = UNFINISHED_STOPS[stopReason]
    if (!stopped && !failure && !unfinished && turn.after?.holds()) {
      // The prompt's reply has ended, though its turn goes on.
      for (const event of this.mapper.finish(Date.now())) this.emit(event)
      turn.after.promptAnswered()
      turn.check = this.watch()
      return this.wait(turn)
    }
    this.conclude(turn, stopped, failure, unfinished)
  }

  /** Ends a turn that ran its course, with the failure its check found or the reason it did not finish. */
  private conclude(turn: Turn, stopped: boolean, failure?: PromptFailure, unfinished?: string) {
    if (this.turn !== turn) return
    if (failure?.repeats) for (const event of this.mapper.dropText(failure.repeats)) this.emit(event)
    const problem = failure?.message ?? unfinished
    if (problem) this.emit({ kind: "item", item: errorItem(problem) })
    this.endTurn(turn, { isError: problem !== undefined, stopped })
  }

  /** What the flavor reads now, to check the work the agent does from here on. */
  private watch(): PromptCheck | undefined {
    return this.live ? this.flavor.watchPrompt?.(this.live.sessionId) : undefined
  }

  /**
   * Ends the turn after an error, which shows in the thread. A sign-in the agent needs signs the account out.
   * Tool calls left open end as unfinished. An agent that answered with an error is still alive, so only the
   * calls it never started end. Any other error means its process is gone, or Comet closed it.
   */
  private fail(turn: Turn, error: unknown) {
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
  private endTurn(turn: Turn, result?: { readonly isError: boolean; readonly stopped: boolean }) {
    const now = Date.now()
    for (const event of this.mapper.finish(now)) this.emit(event)
    if (result) this.emit({ kind: "item", item: { type: "result", id: resultId(turn.id), durationMs: now - turn.start, isError: result.isError, ...(result.stopped ? { stopped: true } : {}) } })
    this.stop.clear()
    turn.after?.clear()
    this.turn = undefined
    if (turn.after) this.nextCheck = this.watch()
    this.emit({ kind: "status", busy: false })
    this.record?.save()
  }
}

/** Comet's tools as an MCP server the agent connects to over HTTP. */
const toolServers = (tools: ToolServer | undefined): McpServer[] =>
  tools ? [{ type: "http", name: SERVER_NAME, url: tools.url, headers: [{ name: "Authorization", value: tools.authorization }] }] : []

