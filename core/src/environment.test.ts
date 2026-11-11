import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Files that may call Bun's spawn and which directly. `test-support.ts` runs only in tests, under the terminal's environment. */
const ALLOWED = ["environment.ts", "test-support.ts"]

test("the core starts programs only through environment.ts", async () => {
  const offenders: string[] = []
  for await (const file of new Bun.Glob("**/*.ts").scan(import.meta.dir)) {
    if (file.endsWith(".test.ts") || ALLOWED.includes(file)) continue
    if (/Bun\.(spawn|spawnSync|which)\b/.test(readFileSync(join(import.meta.dir, file), "utf8"))) offenders.push(file)
  }
  expect(offenders).toEqual([])
})
