import type { ClientMessage, CoreMessage } from "@desk/protocol"

type Listener = (message: CoreMessage) => void

/** The app's one connection to the core. Messages queue until the socket opens. */
class CoreClient {
  private socket?: WebSocket
  private queue: string[] = []
  private listeners = new Set<Listener>()
  private address?: { readonly port: number; readonly token: string }

  async connect() {
    const { port, token } = await window.desk.core()
    this.address = { port, token }
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

  /** The address of a project's icon, which the core serves over HTTP. Undefined before the core connects. */
  iconUrl(dir: string, path: string): string | undefined {
    if (!this.address) return undefined
    const query = new URLSearchParams({ token: this.address.token, dir, path })
    return `http://127.0.0.1:${this.address.port}/project-icon?${query}`
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
