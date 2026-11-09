import { PROTOCOL_VERSION, type ClientMessage, type CoreMessage } from "@desk/protocol"
import type { ServerWebSocket } from "bun"
import pkg from "../package.json"
import { Session } from "./session"
import { readSpace } from "./space"

export interface CoreServer {
  readonly port: number
  stop(): void
}

export interface CoreOptions {
  readonly token: string
  /** The repo the window shows. Sessions run here. */
  readonly dir: string
}

/**
 * Starts the core's WebSocket server on loopback. Only a client that presents the token may connect,
 * because any local process can reach a loopback port.
 */
export function startCore({ token, dir }: CoreOptions): CoreServer {
  const clients = new Set<ServerWebSocket>()
  const sessions = new Map<string, Session>()
  const broadcast = (message: CoreMessage) => {
    const data = JSON.stringify(message)
    for (const client of clients) client.send(data)
  }

  const session = (id: string) => {
    let found = sessions.get(id)
    if (!found) {
      found = new Session(dir, (event) => broadcast({ type: "session.event", sessionId: id, event }))
      sessions.set(id, found)
    }
    return found
  }

  const handle = (ws: ServerWebSocket, message: ClientMessage) => {
    switch (message.type) {
      case "ping":
        return send(ws, { type: "pong", id: message.id })
      case "space.get":
        return void readSpace(dir).then((space) => send(ws, { type: "space", space }))
      case "session.send":
        return session(message.sessionId).send(message.text)
      case "session.interrupt":
        return void sessions.get(message.sessionId)?.interrupt()
      case "session.close":
        sessions.get(message.sessionId)?.close()
        return void sessions.delete(message.sessionId)
      case "permission.answer":
        return sessions.get(message.sessionId)?.answerPermission(message.id, message.allow)
      default:
        return send(ws, { type: "error", message: `Unknown message type: ${(message as { type: unknown }).type}` })
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.searchParams.get("token") !== token) return new Response("Forbidden", { status: 403 })
      if (server.upgrade(request)) return undefined
      return new Response("Expected a WebSocket", { status: 426 })
    },
    websocket: {
      open(ws) {
        clients.add(ws)
        send(ws, { type: "hello", protocol: PROTOCOL_VERSION, core: pkg.version, bun: Bun.version })
      },
      close(ws) {
        clients.delete(ws)
      },
      message(ws, raw) {
        let message: ClientMessage
        try {
          message = JSON.parse(String(raw))
        } catch {
          return send(ws, { type: "error", message: "The message is not valid JSON." })
        }
        handle(ws, message)
      },
    },
  })

  return {
    port: server.port!,
    stop() {
      for (const found of sessions.values()) found.close()
      server.stop(true)
    },
  }
}

function send(ws: ServerWebSocket, message: CoreMessage) {
  ws.send(JSON.stringify(message))
}
