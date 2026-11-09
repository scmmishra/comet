import { PROTOCOL_VERSION, type ClientMessage, type CoreMessage } from "@desk/protocol"
import pkg from "../package.json"

export interface CoreServer {
  readonly port: number
  stop(): void
}

/**
 * Starts the core's WebSocket server on loopback. Only a client that presents `token` may connect,
 * because any local process can reach a loopback port.
 */
export function startCore(token: string): CoreServer {
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
        send(ws, { type: "hello", protocol: PROTOCOL_VERSION, core: pkg.version, bun: Bun.version })
      },
      message(ws, raw) {
        let message: ClientMessage
        try {
          message = JSON.parse(String(raw))
        } catch {
          return send(ws, { type: "error", message: "The message is not valid JSON." })
        }
        switch (message.type) {
          case "ping":
            return send(ws, { type: "pong", id: message.id })
          default:
            return send(ws, { type: "error", message: `Unknown message type: ${(message as { type: unknown }).type}` })
        }
      },
    },
  })
  return { port: server.port!, stop: () => server.stop(true) }
}

function send(ws: { send(data: string): unknown }, message: CoreMessage) {
  ws.send(JSON.stringify(message))
}
