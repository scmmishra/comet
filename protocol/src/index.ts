/** Messages between the Desk app and the core, sent as JSON over one WebSocket. */

export const PROTOCOL_VERSION = 1

/** The line the core prints on stdout once it listens, so the app knows where to connect. */
export interface CoreReady {
  readonly ready: true
  readonly port: number
}

export type ClientMessage = { readonly type: "ping"; readonly id: number }

export type CoreMessage =
  | { readonly type: "hello"; readonly protocol: number; readonly core: string; readonly bun: string }
  | { readonly type: "pong"; readonly id: number }
  | { readonly type: "error"; readonly message: string }
