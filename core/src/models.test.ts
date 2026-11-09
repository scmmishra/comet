import { expect, test } from "bun:test"
import { modelOptions } from "./models"

test("keeps each model's effort levels and default, and none for a model without effort", () => {
  const options = modelOptions([
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "Complex work", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
    { value: "claude-haiku-4-5", displayName: "Haiku 4.5", description: "Quick answers", supportedEffortLevels: ["low"] },
  ], new Map([["opus", "high"]]))
  expect(options).toEqual([
    { value: "opus", label: "Opus 5.5", description: "Complex work", resolvedModel: "claude-opus-5-5", efforts: ["low", "high"], defaultEffort: "high", fast: false, autoMode: false },
    { value: "claude-haiku-4-5", label: "Haiku 4.5", description: "Quick answers", efforts: [], fast: false, autoMode: false },
  ])
})
