import { afterAll, expect, test } from "bun:test"
import type { AgentVersion } from "@comet/protocol"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { until, useTempHome } from "../../test-support"
import type { AgentReading } from "../agent"
import { FAKE_OPTIONS } from "../acp/test-agent"
import { EXECUTABLE, markInstalled, modelsPath, runtimeFolder } from "./home"
import { antigravityAgent } from "."
import { ModelCache } from "./models"

useTempHome()
const saved = process.env.COMET_ANTIGRAVITY
delete process.env.COMET_ANTIGRAVITY
afterAll(() => {
  if (saved !== undefined) process.env.COMET_ANTIGRAVITY = saved
})

function install(version: string) {
  mkdirSync(runtimeFolder(version), { recursive: true })
  writeFileSync(join(runtimeFolder(version), EXECUTABLE), "")
  markInstalled(version)
}

test("reads where Antigravity stands from its files and the keychain, then offers the update Google names", async () => {
  const readings: AgentReading[] = []
  const checked: AgentVersion = { installed: "1.5.8", latest: "1.5.9", updateAvailable: true, updatable: true }
  let signedIn = false
  const agent = antigravityAgent({ publish: (reading) => void readings.push(reading), compactIdle: () => false }, { checkForUpdate: async () => checked, hasSignIn: async () => signedIn })
  await agent.inspect()
  expect(readings.at(-1)).toEqual({ state: "missing", problem: "Install it to use the models of your Google account." })

  // The ACP server an earlier Comet installed no longer runs.
  install("1.4.5")
  await agent.inspect()
  expect(readings.at(-1)).toEqual({ state: "missing", problem: "Comet now runs Google's Antigravity CLI, not the server it installed before. Install the CLI to go on." })

  install("1.5.8")
  await agent.inspect()
  const version = { installed: "1.5.8", updateAvailable: false, updatable: true }
  expect(readings).toContainEqual({ state: "signed-out", problem: "Sign in with your Google account to use its models.", version })
  await until(() => readings.at(-1)?.version === checked)
  expect(readings.at(-1)).toEqual({ version: checked })

  signedIn = true
  const models = new ModelCache(modelsPath).learn(FAKE_OPTIONS, true)
  await agent.inspect()
  expect(readings).toContainEqual({ state: "ready", problem: undefined, version, models })
})
