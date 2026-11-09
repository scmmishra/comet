import { expect, test } from "bun:test"
import { projectDataPath } from "./data-files"

test("names a project's data file after the folder and a hash of its path", () => {
  expect(projectDataPath("commands", "/work/chatwoot")).toMatch(/commands\/chatwoot-[0-9a-f]{8}\.json$/)
  expect(projectDataPath("commands", "/work/chatwoot")).not.toBe(projectDataPath("commands", "/other/chatwoot"))
})
