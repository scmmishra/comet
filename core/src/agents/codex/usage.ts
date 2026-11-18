import type { PlanUsage, UsageWindow } from "@comet/protocol"
import type { RateLimitSnapshot, RateLimitWindow } from "./protocol"
import type { AppServer } from "./server"

/** Windows Comet names in words, by their length in minutes. Others are named by their length. */
const NAMED_WINDOWS: Record<number, string> = { 300: "Session", 10080: "This week" }
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

/**
 * The account's plan usage. A read asks Codex for its limits, and Codex's rate-limit updates keep it
 * current between reads. An update may leave a window out, which keeps what Comet last knew of it.
 */
export class Usage {
  private snapshot?: RateLimitSnapshot

  constructor(
    private readonly server: AppServer,
    private readonly publish: (usage: PlanUsage | undefined) => void,
  ) {
    server.on<{ rateLimits: RateLimitSnapshot }>("account/rateLimits/updated", ({ rateLimits }) => this.update(rateLimits))
  }

  async refresh() {
    const { rateLimits } = await this.server.request<{ rateLimits: RateLimitSnapshot }>("account/rateLimits/read")
    this.snapshot = rateLimits
    this.publish(planUsage(rateLimits))
  }

  /** Codex sends updates for other limits too, such as one model's. Comet shows only the limit it read. */
  private update(rateLimits: RateLimitSnapshot) {
    if (rateLimits.limitId !== null && this.snapshot && rateLimits.limitId !== this.snapshot.limitId) return
    this.snapshot = mergeLimits(this.snapshot, rateLimits)
    this.publish(planUsage(this.snapshot))
  }
}

/** Takes an update into the limits Comet knows. A window the update leaves out keeps its last reading. */
function mergeLimits(current: RateLimitSnapshot | undefined, update: RateLimitSnapshot): RateLimitSnapshot {
  return { limitId: update.limitId ?? current?.limitId ?? null, primary: update.primary ?? current?.primary ?? null, secondary: update.secondary ?? current?.secondary ?? null }
}

/** Codex's limits as Comet's usage windows. Limits with no window have nothing to show. */
export function planUsage(limits: RateLimitSnapshot): PlanUsage | undefined {
  const windows = (["primary", "secondary"] as const).flatMap((id) => {
    const window = limits[id]
    return window ? [usageWindow(id, window)] : []
  })
  return windows.length ? { windows: windows as [UsageWindow, ...UsageWindow[]] } : undefined
}

function usageWindow(id: string, window: RateLimitWindow): UsageWindow {
  return {
    id,
    label: windowLabel(window.windowDurationMins),
    percent: Math.min(100, Math.max(0, window.usedPercent)),
    ...(window.resetsAt ? { resetsAt: new Date(window.resetsAt * 1000).toISOString() } : {}),
  }
}

/** A window by its length: "Session" for five hours, "This week", else "6 hours" or "2 days". */
function windowLabel(minutes: number | null): string {
  if (!minutes) return "Usage"
  if (NAMED_WINDOWS[minutes]) return NAMED_WINDOWS[minutes]
  if (minutes % MINUTES_PER_DAY === 0) return plural(minutes / MINUTES_PER_DAY, "day")
  return plural(Math.round(minutes / MINUTES_PER_HOUR), "hour")
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`
