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
  const folder = folderWith({ name: "comet-plugin-reviews", version: "1.2.0", description: "PRs to review", comet: { name: "reviews", title: "PR Reviews", api: "^0.1.0" } })
  expect(readManifest(folder)).toEqual({ name: "reviews", title: "PR Reviews", api: "^0.1.0", version: "1.2.0", description: "PRs to review" })
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
