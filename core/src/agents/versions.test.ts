import { expect, test } from "bun:test"
import { isNewer } from "./versions"

test("compares versions number by number", () => {
  expect(isNewer("2.1.330", "2.1.322")).toBe(true)
  expect(isNewer("2.2.0", "2.1.322")).toBe(true)
  expect(isNewer("2.1.322", "2.1.322")).toBe(false)
  expect(isNewer("2.1.9", "2.1.10")).toBe(false)
})
