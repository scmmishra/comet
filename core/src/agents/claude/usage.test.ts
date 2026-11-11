import { expect, test } from "bun:test"
import type { PlanUsage } from "@desk/protocol"
import { applyRateLimit, usageFromResponse } from "./usage"

test("reads the session and weekly windows from the usage response", () => {
  const usage = usageFromResponse({
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 42, resets_at: "2026-11-09T20:00:00Z" },
      seven_day: { utilization: 61, resets_at: null },
    },
  } as never)
  expect(usage).toEqual({
    windows: [
      { id: "five_hour", label: "Session", percent: 42, resetsAt: "2026-11-09T20:00:00Z" },
      { id: "seven_day", label: "This week", percent: 61 },
    ],
  })
})

test("has no reading where plan limits do not apply", () => {
  expect(usageFromResponse({ rate_limits_available: false, rate_limits: null } as never)).toBeUndefined()
})

test("updates one window from a rate-limit event, keeping the windows in order", () => {
  const before: PlanUsage = { windows: [{ id: "five_hour", label: "Session", percent: 40 }, { id: "seven_day", label: "This week", percent: 60 }] }
  const after = applyRateLimit(before, { status: "allowed", rateLimitType: "five_hour", utilization: 0.45, resetsAt: 1_794_250_000 })
  expect(after?.windows.map((window) => [window.id, window.percent])).toEqual([
    ["five_hour", 45],
    ["seven_day", 60],
  ])
})

test("adds a window the reading lacked, in its place", () => {
  const before: PlanUsage = { windows: [{ id: "seven_day", label: "This week", percent: 60 }] }
  const after = applyRateLimit(before, { status: "allowed", rateLimitType: "five_hour", utilization: 0.1 })
  expect(after?.windows.map((window) => window.id)).toEqual(["five_hour", "seven_day"])
})
