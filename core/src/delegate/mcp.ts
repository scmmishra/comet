import { METHOD_NOT_FOUND } from "../agents/json-rpc"
import { errorMessage } from "../errors"

/**
 * A Model Context Protocol server over HTTP, as much of it as serving tools takes. Every agent Desk runs
 * connects to an MCP server at a URL, so this is how Desk offers them tools of its own. Each request is
 * one JSON-RPC message, answered with one JSON message. The server sends nothing unasked, so it opens no
 * event stream.
 */

/** A tool as MCP lists it. `inputSchema` is a JSON Schema object. */
export interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** What a tool call answers: text for the model, and whether the call failed. */
export interface ToolResult {
  readonly text: string
  readonly isError?: boolean
}

/** The tools one caller may use, and how each runs. `signal` aborts when the caller gives up on the call. */
export interface ToolSet {
  readonly tools: readonly Tool[]
  call(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>
}

/** The protocol version Desk speaks when a client names none. Desk answers with the client's own when it names one. */
const PROTOCOL_VERSION = "2025-03-26"
const SERVER_INFO = { name: "desk", version: "1" }
const INVALID_REQUEST = -32600

type Request = { readonly id?: number | string; readonly method?: unknown; readonly params?: Record<string, unknown> }

/**
 * Answers one HTTP request to the MCP endpoint. `toolsFor` names the caller's tools from its
 * Authorization header, or nothing for a caller Desk does not know, who is refused.
 */
export async function serveMcp(request: globalThis.Request, toolsFor: (authorization: string) => ToolSet | undefined): Promise<Response> {
  const tools = toolsFor(request.headers.get("authorization") ?? "")
  if (!tools) return new Response("Unauthorized", { status: 401 })
  // A client asks for an event stream with GET and ends its session with DELETE. Desk keeps neither.
  if (request.method === "DELETE") return new Response(null, { status: 200 })
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, DELETE" } })
  let message: Request
  try {
    message = (await request.json()) as Request
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "The request is not JSON." } })
  }
  // A notification expects no answer.
  if (message.id === undefined) return new Response(null, { status: 202 })
  try {
    return json({ jsonrpc: "2.0", id: message.id, result: await answer(message, tools, request.signal) })
  } catch (error) {
    return json({ jsonrpc: "2.0", id: message.id, error: { code: METHOD_NOT_FOUND, message: errorMessage(error) } })
  }
}

async function answer(message: Request, tools: ToolSet, signal: AbortSignal): Promise<unknown> {
  switch (message.method) {
    case "initialize":
      return { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO }
    case "ping":
      return {}
    case "tools/list":
      return { tools: tools.tools }
    case "tools/call": {
      const input = message.params?.arguments
      // A tool that fails answers the model with why, so the model can change course. It is not a protocol error.
      const result = await tools
        .call(String(message.params?.name), typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}, signal)
        .catch((error): ToolResult => ({ text: errorMessage(error), isError: true }))
      return { content: [{ type: "text", text: result.text }], isError: !!result.isError }
    }
    default:
      throw new Error(`Desk's MCP server has no method ${String(message.method)}.`)
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
