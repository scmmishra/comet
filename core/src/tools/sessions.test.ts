import { expect, test } from "bun:test"
import { ToolSessions } from "./sessions"
import type { ToolGroup } from "./tool"

/** A group of one tool that says back what it was given. */
const group = (name: string): ToolGroup => ({
  instructions: `Call \`${name}\` to hear it back.`,
  tools: [{ name, description: "Says it back.", inputSchema: { type: "object" }, summary: () => "", label: () => name }],
  call: async (called, input) => ({ text: `${called}: ${String(input.text)}` }),
})

test("gives each session its groups' tools under its own token, and knows no other caller", async () => {
  const sessions = new ToolSessions(() => "http://127.0.0.1:4000/mcp")
  const { server } = sessions.open([group("echo"), group("shout")])
  expect(server).toMatchObject({ url: "http://127.0.0.1:4000/mcp", instructions: "Call `echo` to hear it back.\nCall `shout` to hear it back." })
  expect(sessions.open([group("echo")]).server.authorization).not.toBe(server.authorization)
  expect(sessions.toolsFor("Bearer nope")).toBeUndefined()

  const tools = sessions.toolsFor(server.authorization)!
  const signal = new AbortController().signal
  expect(tools.tools.map((tool) => tool.name)).toEqual(["echo", "shout"])
  expect(await tools.call("shout", { text: "hi" }, signal)).toEqual({ text: "shout: hi" })
  expect(tools.call("show", {}, signal)).rejects.toThrow("Comet has no tool called show.")
})

test("takes the tools back once the session closes", () => {
  const sessions = new ToolSessions(() => "http://127.0.0.1:4000/mcp")
  const opened = sessions.open([group("echo")])
  opened.close()
  expect(sessions.toolsFor(opened.server.authorization)).toBeUndefined()
})
