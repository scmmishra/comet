import type { ThreadItem } from "@comet/protocol"
import type { Emit } from "./agent"

type RequestItem = Extract<ThreadItem, { type: "permission" | "question" }>

/** A request waiting for the user: the item that shows it, and what gives the agent its reply. Each agent adds what it needs to answer. */
export interface OpenRequest<Reply> {
  readonly item: RequestItem
  readonly resolve: (reply: Reply) => void
}

/**
 * The requests a session has open, permissions and questions, by request id. A request shows as its own
 * item until it is settled, which happens once: a later answer, or a second end, finds it gone.
 */
export class Requests<Reply, R extends OpenRequest<Reply> = OpenRequest<Reply>> {
  private readonly open = new Map<string, R>()

  constructor(private readonly emit: Emit) {}

  add(request: R) {
    this.open.set(request.item.requestId, request)
    this.emit({ kind: "item", item: request.item })
  }

  /** Whether any request waits for the user. */
  get waiting(): boolean {
    return this.open.size > 0
  }

  get(requestId: string): R | undefined {
    return this.open.get(requestId)
  }

  find(matches: (request: R) => boolean): R | undefined {
    return [...this.open.values()].find(matches)
  }

  /** Gives the agent its reply, and takes the request's item out of the thread. */
  settle(request: R, reply: Reply) {
    if (this.open.get(request.item.requestId) !== request) return
    this.open.delete(request.item.requestId)
    this.emit({ kind: "item", item: { ...request.item, answered: true } })
    request.resolve(reply)
  }

  /** Settles every open request, such as when the turn stops or the tab closes. */
  settleAll(reply: (request: R) => Reply) {
    for (const request of [...this.open.values()]) this.settle(request, reply(request))
  }
}
