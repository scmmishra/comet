import { expect, test } from "bun:test"
import { readlinkSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder } from "./test-support"
import { bundledCommand, linkCommand } from "./command-line-tool"

test("finds the command Comet.app carries, and none for a core run from the repo", () => {
  expect(bundledCommand("/Applications/Comet.app/Contents/Resources/core/core/src")).toBe("/Applications/Comet.app/Contents/Resources/bin/comet")
  expect(bundledCommand("/Users/me/code/comet/core/src")).toBeUndefined()
})

test("links the command where nothing is, or a link points nowhere, and leaves a working one", () => {
  const folder = join(tempFolder("bin"), "bin")
  const command = join(tempFolder("app"), "comet")
  writeFileSync(command, "#!/bin/bash\n")

  expect(linkCommand(command, folder)).toBe(true)
  expect(readlinkSync(join(folder, "comet"))).toBe(command)
  expect(linkCommand("/elsewhere/comet", folder)).toBe(false)
  expect(readlinkSync(join(folder, "comet"))).toBe(command)

  const mine = tempFolder("own")
  writeFileSync(join(mine, "comet"), "mine")
  expect(linkCommand(command, mine)).toBe(false)
})

test("replaces a link whose app is gone", () => {
  const folder = tempFolder("bin")
  symlinkSync("/no/such/Comet.app/Contents/Resources/bin/comet", join(folder, "comet"))
  const command = join(tempFolder("app"), "comet")
  writeFileSync(command, "#!/bin/bash\n")
  expect(linkCommand(command, folder)).toBe(true)
  expect(readlinkSync(join(folder, "comet"))).toBe(command)
})
