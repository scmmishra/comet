import { afterAll, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { useTempHome } from "../../test-support"
import type { AgentReading } from "../agent"
import { FAKE_OPTIONS } from "../acp/test-agent"
import { markInstalled, modelsPath, tokenPath } from "./home"
import { antigravityAgent } from "."
import { modesFor } from "./modes"
import { ModelCache } from "./models"
import { RELEASE } from "./release"

useTempHome()
const savedPath = process.env.PATH
process.env.PATH = ""
afterAll(() => (process.env.PATH = savedPath))

test("reads where Antigravity stands from its files alone: missing, signed out, then ready with the cached models", async () => {
  const readings: AgentReading[] = []
  const agent = antigravityAgent({ publish: (reading) => void readings.push(reading), compactIdle: () => false })
  await agent.inspect()
  expect(readings.at(-1)).toEqual({ state: "missing", problem: "Install it to use the models of your Google account." })

  markInstalled(RELEASE.version)
  await agent.inspect()
  const version = { installed: RELEASE.version, updateAvailable: false, updatable: false }
  expect(readings.at(-1)).toEqual({ state: "signed-out", problem: "Sign in with your Google account to use its models.", version })

  mkdirSync(dirname(tokenPath()), { recursive: true })
  writeFileSync(tokenPath(), "{}")
  const models = new ModelCache(modelsPath, () => modesFor("server")).learn(FAKE_OPTIONS, true)
  await agent.inspect()
  expect(readings.at(-1)).toEqual({ state: "ready", problem: undefined, version, models })
})
