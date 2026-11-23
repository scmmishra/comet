import { expect, test } from "bun:test"
import type { PermissionMode } from "@comet/protocol"
import { useTempHome } from "../../test-support"
import type { PermissionRequest, ToolCall } from "../acp/protocol"
import { antigravityFlavor } from "./flavor"
import { modelsPath } from "./home"
import { ModelCache } from "./models"

useTempHome()

const flavor = antigravityFlavor({ publish: () => {}, compactIdle: () => false }, new ModelCache(modelsPath))

test("names itself Comet, and runs each of Comet's modes the CLI has, asking in the one it lacks", () => {
  expect(flavor.connect).toEqual({ clientInfo: { name: "comet", version: expect.any(String) }, authMethod: "oauth-personal" })
  const modes: PermissionMode[] = ["default", "acceptEdits", "auto", "bypassPermissions"]
  expect(modes.map((mode) => flavor.modeId(mode))).toEqual(["default", "accept-edits", "auto", "default"])
})

test("reads a permission request whose call id marks an interaction as a question", () => {
  const request = (toolCallId: string): PermissionRequest => ({ sessionId: "s1", toolCall: { toolCallId }, options: [] })
  expect(flavor.isQuestion?.(request("interaction_1"))).toBe(true)
  expect(flavor.isQuestion?.(request("t1"))).toBe(false)
})

test("holds a turn for a command or a scheduled wake that runs past the prompt, but not for a daemon", () => {
  const background = flavor.background!
  const command = (rawInput: unknown): ToolCall => ({ toolCallId: "t1", kind: "execute", title: "sleep 20", status: "in_progress", rawInput })
  expect(background.outlivesPrompt(command({ CommandLine: "sleep 20", IsDaemon: false }))).toBe(true)
  // A call may leave IsDaemon out.
  expect(background.outlivesPrompt(command({ CommandLine: "sleep 20" }))).toBe(true)
  expect(background.outlivesPrompt(command({ CommandLine: "python3 -m http.server", IsDaemon: true }))).toBe(false)
  expect(background.outlivesPrompt({ toolCallId: "t2", kind: "other", title: "Run schedule", rawInput: { DurationSeconds: 20 } })).toBe(true)
  expect(background.outlivesPrompt({ toolCallId: "t3", kind: "read", title: "Read a.ts" })).toBe(false)
  expect(background.endsReply({ sessionUpdate: "usage_update", used: 1, size: 2 })).toBe(true)
  expect(background.endsReply({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "DONE" } })).toBe(false)
})
