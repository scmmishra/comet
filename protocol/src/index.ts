/** Messages between the Desk app and the core, sent as JSON over one WebSocket. */

export const PROTOCOL_VERSION = 1

/** The line the core prints on stdout once it listens, so the app knows where to connect. */
export interface CoreReady {
  readonly ready: true
  readonly port: number
}

/**
 * One step of a thread, already shaped for drawing. The core turns the Agent SDK's messages into
 * these, so the app never reads SDK types.
 */
export type ThreadEvent =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  /** Assistant text. A later event with the same id replaces the text; `delta` appends to it. */
  | { readonly kind: "text"; readonly id: string; readonly text: string; readonly done: boolean }
  | { readonly kind: "text.delta"; readonly id: string; readonly delta: string }
  | { readonly kind: "thinking"; readonly id: string }
  | { readonly kind: "tool"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly kind: "tool.result"; readonly id: string; readonly output: string; readonly isError: boolean }
  | { readonly kind: "permission"; readonly id: string; readonly tool: string; readonly input: Record<string, unknown> }
  | { readonly kind: "permission.resolved"; readonly id: string; readonly allowed: boolean }
  | { readonly kind: "result"; readonly id: string; readonly durationMs: number; readonly costUsd?: number; readonly isError: boolean }
  | { readonly kind: "status"; readonly busy: boolean }
  | { readonly kind: "init"; readonly model: string }
  | { readonly kind: "error"; readonly id: string; readonly message: string }

export type ClientMessage =
  | { readonly type: "ping"; readonly id: number }
  | { readonly type: "session.send"; readonly sessionId: string; readonly text: string }
  | { readonly type: "session.interrupt"; readonly sessionId: string }
  | { readonly type: "session.close"; readonly sessionId: string }
  | { readonly type: "permission.answer"; readonly sessionId: string; readonly id: string; readonly allow: boolean }

export type CoreMessage =
  | { readonly type: "hello"; readonly protocol: number; readonly core: string; readonly bun: string }
  | { readonly type: "pong"; readonly id: number }
  | { readonly type: "session.event"; readonly sessionId: string; readonly event: ThreadEvent }
  | { readonly type: "error"; readonly message: string }
