import { expect, test } from "bun:test"
import { DEFAULT_MODEL, PERMISSION_MODES } from "@desk/protocol"
import { modelName, modelOptions, turnModel } from "./models"
import { MODELS } from "./fake-app-server"

test("lists Codex's default first, then every model Codex shows", () => {
  expect(modelOptions(MODELS)).toEqual([
    { value: DEFAULT_MODEL, label: "Default", runs: "GPT-6.1-Sol", description: "GPT-6.1-Sol model", efforts: ["low", "high"], defaultEffort: "low", fast: true, permissionModes: PERMISSION_MODES },
    { value: "gpt-6.1-sol", label: "GPT-6.1-Sol", description: "GPT-6.1-Sol model", efforts: ["low", "high"], defaultEffort: "low", fast: true, permissionModes: PERMISSION_MODES },
    { value: "gpt-6-luna", label: "GPT-6-Luna", description: "GPT-6-Luna model", efforts: ["low", "high"], defaultEffort: "high", fast: false, permissionModes: PERMISSION_MODES },
  ])
})

test("names the model, effort and speed of every turn, so a tab set back to Default runs the default", () => {
  const settings = { agent: "codex" as const, permissionMode: "default" as const }
  expect(turnModel(MODELS, { ...settings, model: DEFAULT_MODEL })).toEqual({ model: "gpt-6.1-sol", effort: "low", serviceTier: null })
  expect(turnModel(MODELS, { ...settings, model: "gpt-6-luna", effort: "low", fast: true })).toEqual({ model: "gpt-6-luna", effort: "low", serviceTier: "priority" })
  expect(turnModel([], { ...settings, model: DEFAULT_MODEL })).toEqual({ serviceTier: null })
  expect(turnModel([], { ...settings, model: "gpt-7" })).toEqual({ model: "gpt-7", serviceTier: null })
})

test("names a model by its display name, and leaves an unknown id as it is", () => {
  expect(modelName(MODELS, "gpt-6-luna")).toBe("GPT-6-Luna")
  expect(modelName(MODELS, "gpt-7")).toBe("gpt-7")
})
