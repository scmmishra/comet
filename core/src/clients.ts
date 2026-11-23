import type { CoreMessage } from "@comet/protocol"
import { ThreadRows } from "./thread-rows"

type Send = (message: CoreMessage) => void

/** A connected client, as the core writes to it. */
export interface Socket {
  send(data: string): void
}

/**
 * The connected clients. Every message passes through here on its way out, so each client gets the rows
 * that follow it. Each client keeps its own rows, after T3 Code's per-subscription state, so what one
 * client is sent, such as a thread's history it asked for, never changes what another is sent next.
 */
export class Clients {
  private readonly clients = new Map<Socket, ThreadRows>()

  add(socket: Socket) {
    this.clients.set(socket, new ThreadRows())
  }

  remove(socket: Socket) {
    this.clients.delete(socket)
  }

  /** Sends to every client. */
  readonly broadcast: Send = (message) => {
    const data = wireJson(message)
    for (const [socket, rows] of this.clients) deliver(socket, rows, message, data)
  }

  /** Sends to one client. */
  replyTo(socket: Socket): Send {
    return (message) => {
      const rows = this.clients.get(socket)
      if (rows) deliver(socket, rows, message, wireJson(message))
    }
  }

  /** Forgets a closed tab's thread. */
  forget(tabId: string) {
    for (const rows of this.clients.values()) rows.forget(tabId)
  }
}

function deliver(socket: Socket, rows: ThreadRows, message: CoreMessage, data: string) {
  socket.send(data)
  const after = rows.after(message)
  if (after) socket.send(wireJson(after))
}

/**
 * A message as JSON the client can read. The client rejects JSON that holds half of a surrogate pair, and drops the
 * whole message. Comet cuts its own text whole, but an agent can send text with half of one, so such text gets a
 * replacement character. JSON.stringify writes half a pair as an escape such as `\ud83d`, so only a message with
 * one is written again.
 */
function wireJson(message: unknown): string {
  const data = JSON.stringify(message)
  return data.includes("\\ud") ? JSON.stringify(message, (_, value) => (typeof value === "string" ? value.toWellFormed() : value)) : data
}
