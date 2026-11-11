import { expect, test } from "bun:test"
import { join } from "node:path"
import { tempFolder } from "../../test-support"
import { FAKE_OPTIONS } from "../acp/test-agent"
import { ModelCache } from "./models"
import { modesFor } from "./modes"

const MODES = ["default", "acceptEdits", "bypassPermissions"] as const

test("lists the account's default first, then each model, and learns thinking levels as models are selected", () => {
  const path = join(tempFolder("antigravity-models"), "models.json")
  const cache = new ModelCache(() => path, () => MODES)
  expect(cache.options()).toEqual([{ value: "default", label: "Default", description: "", efforts: [], fast: false, permissionModes: MODES }])

  expect(cache.learn(FAKE_OPTIONS, true)).toEqual([
    { value: "default", label: "Default", description: "", runs: "Gemini Pro", efforts: ["low", "high"], fast: false, permissionModes: MODES },
    { value: "gemini-pro", label: "Gemini Pro", description: "Google's best", efforts: ["low", "high"], fast: false, permissionModes: MODES },
    { value: "claude-sonnet", label: "Claude Sonnet", description: "", efforts: [], fast: false, permissionModes: MODES },
  ])

  // A session that selected another model says nothing of the account's default.
  const sonnet = FAKE_OPTIONS.map((option) => (option.id === "model" ? { ...option, currentValue: "claude-sonnet" } : { ...option, options: [{ value: "max", name: "Max" }] }))
  const learned = cache.learn(sonnet, false)
  expect(learned[0]).toMatchObject({ runs: "Gemini Pro", efforts: ["low", "high"] })
  expect(learned[2]).toMatchObject({ value: "claude-sonnet", efforts: ["max"] })
  expect(cache.learn([], false)).toEqual(learned)
})

test("offers only the mode the agy CLI honours, and every mode on Antigravity's server", () => {
  expect(modesFor("cli")).toEqual(["default"])
  expect(modesFor("server")).toEqual(["default", "acceptEdits", "bypassPermissions"])
  const cache = new ModelCache(() => join(tempFolder("antigravity-models"), "models.json"), () => modesFor("cli"))
  expect(cache.options()[0]!.permissionModes).toEqual(["default"])
})
