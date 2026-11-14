import { expect, test } from "bun:test"
import type { PermissionMode } from "@desk/protocol"
import { useTempHome } from "../../test-support"
import type { PermissionRequest } from "../acp/protocol"
import { antigravityFlavor } from "./flavor"
import { modelsPath } from "./home"
import { ModelCache } from "./models"

useTempHome()

const flavor = antigravityFlavor({ publish: () => {}, compactIdle: () => false }, new ModelCache(modelsPath))

test("names itself Desk, and runs each of Desk's modes the CLI has, asking in the one it lacks", () => {
  expect(flavor.connect).toEqual({ clientInfo: { name: "desk", version: expect.any(String) }, authMethod: "oauth-personal" })
  const modes: PermissionMode[] = ["default", "acceptEdits", "auto", "bypassPermissions"]
  expect(modes.map((mode) => flavor.modeId(mode))).toEqual(["default", "accept-edits", "auto", "default"])
})

test("reads a permission request whose call id marks an interaction as a question", () => {
  const request = (toolCallId: string): PermissionRequest => ({ sessionId: "s1", toolCall: { toolCallId }, options: [] })
  expect(flavor.isQuestion?.(request("interaction_1"))).toBe(true)
  expect(flavor.isQuestion?.(request("t1"))).toBe(false)
})
