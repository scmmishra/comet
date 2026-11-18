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
    const data = JSON.stringify(message)
    for (const [socket, rows] of this.clients) deliver(socket, rows, message, data)
  }

  /** Sends to one client. */
  replyTo(socket: Socket): Send {
    return (message) => {
      const rows = this.clients.get(socket)
      if (rows) deliver(socket, rows, message, JSON.stringify(message))
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
  if (after) socket.send(JSON.stringify(after))
}
