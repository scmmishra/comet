import type { ClientMessage, CoreMessage } from "@desk/protocol"

type Listener = (message: CoreMessage) => void

/** The app's one connection to the core. Messages queue until the socket opens. */
export class CoreClient {
  private socket?: WebSocket
  private queue: string[] = []
  private listeners = new Set<Listener>()

  async connect() {
    const { port, token } = await window.desk.core()
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
    this.socket = socket
    socket.onopen = () => {
      for (const data of this.queue) socket.send(data)
      this.queue = []
    }
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as CoreMessage
      for (const listener of this.listeners) listener(message)
    }
  }

  send(message: ClientMessage) {
    const data = JSON.stringify(message)
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data)
    else this.queue.push(data)
  }

  listen(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const core = new CoreClient()
