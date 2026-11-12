import { afterAll, expect, test } from "bun:test"
import type { PermissionMode } from "@desk/protocol"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder, useTempHome } from "../../test-support"
import type { PermissionRequest } from "../acp/protocol"
import { antigravityFlavor } from "./flavor"
import { markInstalled, modelsPath } from "./home"
import { ModelCache } from "./models"
import { RELEASE } from "./release"

useTempHome()
const saved = process.env.DESK_ANTIGRAVITY
afterAll(() => {
  if (saved === undefined) delete process.env.DESK_ANTIGRAVITY
  else process.env.DESK_ANTIGRAVITY = saved
})

const flavor = antigravityFlavor({ publish: () => {}, compactIdle: () => false }, new ModelCache(modelsPath, () => []))

test("runs each of Desk's modes on the server, and always asks on the agy CLI", () => {
  delete process.env.DESK_ANTIGRAVITY
  markInstalled(RELEASE.version)
  const modes: PermissionMode[] = ["default", "auto", "acceptEdits", "bypassPermissions"]
  expect(modes.map((mode) => flavor.modeId(mode))).toEqual(["default", "default", "auto_edit", "yolo"])

  const cli = join(tempFolder("antigravity-cli"), "agy")
  writeFileSync(cli, "#!/bin/sh\n")
  chmodSync(cli, 0o755)
  process.env.DESK_ANTIGRAVITY = cli
  expect(flavor.modeId("bypassPermissions")).toBe("default")
  expect(flavor.modeId("acceptEdits")).toBe("default")
})

test("turns off the run-workflow tool only for the releases that write its skill", () => {
  const meta = (version: string) => flavor.sessionMeta?.({ protocolVersion: 1, agentInfo: { name: "agy", version } })
  expect(["1.4.1", "1.4.2", "1.4.5", "1.4.6", "1.5.0", "unknown"].map((version) => meta(version) !== undefined)).toEqual([false, true, true, false, false, false])
  expect(meta("1.4.3")).toEqual({ antigravity: { disabledTools: ["run_workflow"] } })
})

test("reads a permission request whose call id marks an interaction as a question", () => {
  const request = (toolCallId: string): PermissionRequest => ({ sessionId: "s1", toolCall: { toolCallId }, options: [] })
  expect(flavor.isQuestion?.(request("interaction_1"))).toBe(true)
  expect(flavor.isQuestion?.(request("t1"))).toBe(false)
})
