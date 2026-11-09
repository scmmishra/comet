import { expect, test } from "bun:test"
import { formatDuration } from "./format"

test("formats a duration in seconds, then minutes, leaving out zero seconds", () => {
  expect(formatDuration(5_000)).toBe("5 s")
  expect(formatDuration(59_400)).toBe("59 s")
  expect(formatDuration(180_000)).toBe("3 min")
  expect(formatDuration(184_000)).toBe("3 min 4 s")
})
