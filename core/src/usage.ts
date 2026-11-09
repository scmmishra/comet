import { query, type SDKControlGetUsageResponse, type SDKRateLimitInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { PlanUsage, UsageWindow } from "@desk/protocol"

const PROBE_TIMEOUT_MS = 20_000
const LABELS = { five_hour: "Session", seven_day: "This week" } as const
type WindowId = keyof typeof LABELS

/**
 * Reads plan usage the way T3 Code does: a query whose prompt never yields, so nothing reaches the
 * model, and the SDK's usage call once it starts. The call is marked experimental, so a failure only
 * means no reading.
 */
export async function probeUsage(dir: string): Promise<PlanUsage | undefined> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS)
  try {
    const probe = query({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
      })(),
      // A probe must leave nothing behind: no saved session, no hooks run, no MCP servers started.
      options: { cwd: dir, abortController: abort, persistSession: false, settings: { disableAllHooks: true }, mcpServers: {}, strictMcpConfig: true },
    })
    await probe.initializationResult()
    // skipBehaviors avoids a scan of local transcripts that only the /usage screen needs.
    return usageFromResponse(await probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }))
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    abort.abort()
  }
}

/** The usage response's percentages are already 0–100. */
export function usageFromResponse(response: Pick<SDKControlGetUsageResponse, "rate_limits_available" | "rate_limits">): PlanUsage | undefined {
  if (!response.rate_limits_available || !response.rate_limits) return undefined
  const windows: UsageWindow[] = []
  for (const id of Object.keys(LABELS) as WindowId[]) {
    const window = response.rate_limits[id]
    if (typeof window?.utilization !== "number") continue
    windows.push({ id, label: LABELS[id], percent: clamp(window.utilization), ...(window.resets_at ? { resetsAt: window.resets_at } : {}) })
  }
  return windows.length ? { windows } : undefined
}

/** Updates a reading from a rate-limit event, which a session receives during a turn. Its utilization is 0–1. */
export function applyRateLimit(current: PlanUsage | undefined, info: SDKRateLimitInfo): PlanUsage | undefined {
  const id = info.rateLimitType
  if (!id || !(id in LABELS) || typeof info.utilization !== "number") return current
  const window: UsageWindow = {
    id: id as WindowId,
    label: LABELS[id as WindowId],
    percent: clamp(info.utilization * 100),
    ...(info.resetsAt ? { resetsAt: new Date(info.resetsAt * 1000).toISOString() } : {}),
  }
  const others = (current?.windows ?? []).filter((found) => found.id !== window.id)
  return { windows: [...others, window].sort((a, b) => a.id.localeCompare(b.id)) }
}

const clamp = (percent: number) => Math.min(100, Math.max(0, percent))
