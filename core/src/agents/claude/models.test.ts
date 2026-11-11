import { expect, test } from "bun:test"
import { claudeAccount, modelLabel, modelOptions } from "./models"

test("keeps each model's effort levels and default, and none for a model without effort", () => {
  const options = modelOptions([
    { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default", description: "Complex work", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsAutoMode: true },
    { value: "claude-haiku-4-5", resolvedModel: "claude-haiku-4-5", displayName: "Haiku 4.5", description: "Quick answers", supportedEffortLevels: ["low"] },
  ], new Map([["default", "high"]]))
  expect(options).toEqual([
    { value: "default", label: "Default", description: "Complex work", runs: "Opus 5.5", efforts: ["low", "high"], defaultEffort: "high", fast: false, permissionModes: ["default", "acceptEdits", "auto", "bypassPermissions"] },
    { value: "claude-haiku-4-5", label: "Haiku 4.5", description: "Quick answers", efforts: [], fast: false, permissionModes: ["default", "acceptEdits", "bypassPermissions"], older: true },
  ])
})

test("names a model that runs, and leaves an id of another shape as it is", () => {
  expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5")
  expect(modelLabel("claude-haiku-5-20260101")).toBe("Haiku 5")
  expect(modelLabel("opus")).toBe("opus")
})

test("reads the signed-in account, and none when Claude Code is not signed in", () => {
  expect(claudeAccount({ email: "ada@example.com", subscriptionType: "max", apiProvider: "firstParty" })).toEqual({ email: "ada@example.com", plan: "max" })
  expect(claudeAccount({ apiKeySource: "ANTHROPIC_API_KEY" })).toEqual({ method: "an API key from ANTHROPIC_API_KEY" })
  expect(claudeAccount({ apiProvider: "bedrock" })).toEqual({ method: "bedrock" })
  expect(claudeAccount({ apiProvider: "firstParty" })).toBeUndefined()
  expect(claudeAccount(undefined)).toBeUndefined()
})
