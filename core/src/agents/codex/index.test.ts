import { expect, test } from "bun:test"
import type { AgentReading } from "../agent"
import { until } from "../../test-support"
import { CodexMissing } from "./executable"
import { codexAgent } from "./index"
import type { Launch } from "./server"
import { fakeAppServer, MODELS } from "./test-app-server"

function agent(launch?: Launch) {
  const codex = fakeAppServer()
  const readings: AgentReading[] = []
  const made = codexAgent({ publish: (reading) => void readings.push(reading), compactIdle: () => false }, launch ?? codex.launch)
  return { codex, readings, agent: made }
}

const LIMITS = { limitId: "codex", limitName: null, primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1794428685 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1795015485 } }

test("reads the version, the ChatGPT account and the models", async () => {
  const { codex, readings, agent: codexDesk } = agent()
  codex.answer("account/read", { account: { type: "chatgpt", email: "ada@example.com", planType: "plus", workspaceName: "Analytical" }, requiresOpenaiAuth: true })
  codex.answer("model/list", ({ cursor }: { cursor?: string }) => (cursor ? { data: MODELS.slice(1), nextCursor: null } : { data: MODELS.slice(0, 1), nextCursor: "2" }))
  await codexDesk.inspect()
  expect(readings[0]).toEqual({ version: { installed: "0.167.0", updateAvailable: false, updatable: false } })
  expect(readings[1]).toEqual({ state: "ready", problem: undefined, account: { email: "ada@example.com", plan: "plus", organization: "Analytical" } })
  expect(readings[2]!.models!.map((model) => model.value)).toEqual(["default", "gpt-6.1-sol", "gpt-6-luna"])
})

test("says how to install Codex when Desk finds none", async () => {
  const { readings, agent: codexDesk } = agent(() => {
    throw new CodexMissing()
  })
  await codexDesk.inspect()
  expect(readings).toEqual([{ state: "missing", problem: "Install the Codex CLI so `codex` is on your PATH." }])
})

test("says how to sign in when Codex has no account, and names other ways of signing in", async () => {
  const { codex, readings, agent: codexDesk } = agent()
  codex.answer("account/read", { account: null, requiresOpenaiAuth: true })
  await codexDesk.inspect()
  expect(readings.at(-1)).toEqual({ state: "signed-out", problem: "Run `codex login` in a terminal to sign in.", account: undefined })
  codex.answer("account/read", { account: { type: "apiKey" }, requiresOpenaiAuth: true })
  codex.answer("model/list", { data: [], nextCursor: null })
  await codexDesk.inspect()
  expect(readings).toContainEqual({ state: "ready", problem: undefined, account: { method: "an API key" } })
  codex.answer("account/read", { account: { type: "amazonBedrock", usesCodexManagedCredentials: true }, requiresOpenaiAuth: true })
  await codexDesk.inspect()
  expect(readings).toContainEqual({ state: "ready", problem: undefined, account: { method: "Amazon Bedrock" } })
})

test("reads plan usage by window, and keeps it current from Codex's updates", async () => {
  const { codex, readings, agent: codexDesk } = agent()
  codex.answer("account/rateLimits/read", { rateLimits: LIMITS })
  await codexDesk.refreshUsage()
  expect(readings.at(-1)).toEqual({
    usage: {
      windows: [
        { id: "primary", label: "Session", percent: 12, resetsAt: new Date(1794428685 * 1000).toISOString() },
        { id: "secondary", label: "This week", percent: 40, resetsAt: new Date(1795015485 * 1000).toISOString() },
      ],
    },
  })
  // An update for another limit is not shown. One for this limit keeps the windows it leaves out.
  codex.notify("account/rateLimits/updated", { rateLimits: { ...LIMITS, limitId: "gpt-6-sol", primary: { usedPercent: 90, windowDurationMins: 120, resetsAt: null } } })
  codex.notify("account/rateLimits/updated", { rateLimits: { limitId: null, primary: { usedPercent: 15, windowDurationMins: 360, resetsAt: null }, secondary: null } })
  await until(() => readings.length === 2)
  expect(readings.at(-1)!.usage!.windows.map(({ label, percent }) => [label, percent])).toEqual([["6 hours", 15], ["This week", 40]])
  codex.answer("account/rateLimits/read", { rateLimits: { limitId: "codex", primary: null, secondary: null } })
  await codexDesk.refreshUsage()
  expect(readings.at(-1)).toEqual({ usage: undefined })
})
