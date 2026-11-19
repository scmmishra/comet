import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder } from "../test-support"
import { API_VERSION, readManifest } from "./manifest"

const folderWith = (pkg: unknown) => {
  const folder = tempFolder("manifest")
  writeFileSync(join(folder, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg))
  return folder
}

test("reads the comet field with the package's version and description", () => {
  const folder = folderWith({ name: "comet-plugin-reviews", version: "1.2.0", description: "PRs to review", comet: { name: "reviews", title: "PR Reviews", api: "^0.2.0" } })
  expect(readManifest(folder)).toEqual({ name: "reviews", title: "PR Reviews", api: "^0.2.0", settings: [], version: "1.2.0", description: "PRs to review" })
})

test("a folder without a package.json or a comet field has no manifest", () => {
  expect(readManifest(tempFolder("manifest"))).toBeUndefined()
  expect(readManifest(folderWith({ name: "plain" }))).toBeUndefined()
})

test("refuses a broken manifest", () => {
  expect(() => readManifest(folderWith("{"))).toThrow("is not valid JSON")
  expect(() => readManifest(folderWith({ comet: "reviews" }))).toThrow("must be an object")
  expect(() => readManifest(folderWith({ comet: { name: "Reviews" } }))).toThrow("must have a name")
  expect(() => readManifest(folderWith({ comet: { name: "reviews", api: 1 } }))).toThrow(`such as "^${API_VERSION}"`)
})

test("reads the settings a plugin asks for, and refuses one it cannot use", () => {
  const settings = [
    { key: "repo", title: "Repository", type: "string", required: true, default: "chatwoot/chatwoot" },
    { key: "notes", title: "Notes", type: "text" },
    { key: "drafts", title: "Show drafts", type: "boolean", default: false },
    { key: "sort", title: "Sort", type: "select", options: ["updated", "created"], default: "updated" },
  ]
  expect(readManifest(folderWith({ comet: { name: "reviews", settings } }))?.settings).toEqual(settings as never)
  const broken = (setting: unknown) => () => readManifest(folderWith({ comet: { name: "reviews", settings: [setting] } }))
  expect(broken({ key: "has space", title: "T", type: "string" })).toThrow("need a key")
  expect(broken({ key: "repo", type: "string" })).toThrow("need a title for repo")
  expect(broken({ key: "repo", title: "T", type: "number" })).toThrow("a type of string, text, boolean, select")
  expect(broken({ key: "sort", title: "T", type: "select" })).toThrow("list the options of sort")
  expect(broken({ key: "on", title: "T", type: "boolean", default: "yes" })).toThrow("a default that is true or false")
  expect(broken({ key: "sort", title: "T", type: "select", options: ["a"], default: "b" })).toThrow("a default that is one of a")
  expect(() => readManifest(folderWith({ comet: { name: "reviews", settings: [settings[0], settings[0]] } }))).toThrow("name repo twice")
})
