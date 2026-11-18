import type { SDKControlGetUsageResponse, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"
import type { PlanUsage, UsageWindow } from "@comet/protocol"
import { homedir } from "node:os"
import { probe } from "./probe"

/** Plan usage is probed at most this often. Sessions' rate-limit events keep it current in between. */
const PROBE_INTERVAL_MS = 60_000

/** The windows Comet shows, in the order it shows them. */
const WINDOWS = [
  { id: "five_hour", label: "Session" },
  { id: "seven_day", label: "This week" },
] as const satisfies readonly Pick<UsageWindow, "id" | "label">[]

/** The account's plan usage. It reads the same from any folder, so it is read from the home folder. */
export class Usage {
  private usage?: PlanUsage
  private probedAt = 0

  constructor(private readonly publish: (usage: PlanUsage | undefined) => void) {}

  /** Probes again unless a probe ran in the last minute, then reports the reading. */
  async refresh() {
    if (Date.now() - this.probedAt >= PROBE_INTERVAL_MS) {
      this.probedAt = Date.now()
      this.usage = (await probeUsage(homedir())) ?? this.usage
    }
    this.publish(this.usage)
  }

  /** Takes a rate-limit event, which a session receives during a turn. */
  rateLimit(info: SDKRateLimitInfo) {
    this.usage = applyRateLimit(this.usage, info)
    this.publish(this.usage)
  }
}

/**
 * Reads plan usage through the SDK's usage call. The call is marked experimental, so a failure only
 * means no reading. skipBehaviors avoids a scan of local transcripts that only the /usage screen needs.
 */
function probeUsage(dir: string): Promise<PlanUsage | undefined> {
  return probe(dir, async (running) => usageFromResponse(await running.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })))
}

/** The usage response's percentages are already 0–100. */
export function usageFromResponse(response: Pick<SDKControlGetUsageResponse, "rate_limits_available" | "rate_limits">): PlanUsage | undefined {
  if (!response.rate_limits_available || !response.rate_limits) return undefined
  return planUsage(
    WINDOWS.flatMap(({ id, label }) => {
      const window = response.rate_limits?.[id]
      return typeof window?.utilization === "number" ? [{ id, label, percent: clamp(window.utilization), ...(window.resets_at ? { resetsAt: window.resets_at } : {}) }] : []
    }),
  )
}

/** Updates a reading from a rate-limit event. Its utilization is 0–1. Other limit types are not shown. */
export function applyRateLimit(current: PlanUsage | undefined, info: SDKRateLimitInfo): PlanUsage | undefined {
  const shown = WINDOWS.find((window) => window.id === info.rateLimitType)
  if (!shown || typeof info.utilization !== "number") return current
  const window: UsageWindow = {
    ...shown,
    percent: clamp(info.utilization * 100),
    ...(info.resetsAt ? { resetsAt: new Date(info.resetsAt * 1000).toISOString() } : {}),
  }
  const windows = new Map((current?.windows ?? []).map((found) => [found.id, found]))
  windows.set(window.id, window)
  return planUsage(WINDOWS.flatMap(({ id }) => windows.get(id) ?? []))
}

/** Usage with no window has nothing to show. */
const planUsage = (windows: UsageWindow[]): PlanUsage | undefined => (windows.length ? { windows: windows as [UsageWindow, ...UsageWindow[]] } : undefined)

const clamp = (percent: number) => Math.min(100, Math.max(0, percent))
