import { expect, test } from "bun:test"
import { formatDuration, formatTokens } from "./format"

test("formats a duration in seconds, then minutes, leaving out zero seconds", () => {
  expect(formatDuration(5_000)).toBe("5 s")
  expect(formatDuration(59_400)).toBe("59 s")
  expect(formatDuration(180_000)).toBe("3 min")
  expect(formatDuration(184_000)).toBe("3 min 4 s")
})

test("writes token counts in short", () => {
  expect([820, 32_400, 999_499, 999_500, 1_200_000, 2_000_000].map(formatTokens)).toEqual(["820", "32k", "999k", "1M", "1.2M", "2M"])
})
