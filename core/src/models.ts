import type { ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk"
import { DEFAULT_MODEL, type Effort, type ModelOption } from "@desk/protocol"
import { probe } from "./probe"

/**
 * The SDK's settings read, which it ships without a type. `applied.effort` is the effort the next
 * message would use. Desk only reads it, so a change to it costs the Default label, not a session.
 */
type SettingsReader = { getSettings(): Promise<{ applied?: { effort?: Effort | null } }> }

/**
 * The models Claude Code offers this account, in its order. `publish` gets the list as soon as the
 * query starts, then again with each model's default effort, which takes seconds to read.
 */
export async function probeModels(dir: string, publish: (models: ModelOption[]) => void): Promise<void> {
  await probe(dir, async (running) => {
    const models = (await running.initializationResult()).models
    publish(modelOptions(models))
    publish(modelOptions(models, await defaultEfforts(running, models)))
  })
}

/** Switches the probe's model to each one in turn and reads the effort Claude Code would use. */
async function defaultEfforts(running: Query, models: readonly ModelInfo[]): Promise<Map<string, Effort>> {
  const efforts = new Map<string, Effort>()
  for (const model of models) {
    if (!model.supportsEffort) continue
    try {
      await running.setModel(model.value === DEFAULT_MODEL ? undefined : model.value)
      const effort = (await (running as unknown as SettingsReader).getSettings()).applied?.effort
      if (effort) efforts.set(model.value, effort)
    } catch {
      // Without a reading, the picker shows Default with no level beside it.
    }
  }
  return efforts
}

export function modelOptions(models: readonly ModelInfo[], defaultEfforts: ReadonlyMap<string, Effort> = new Map()): ModelOption[] {
  return models.map((model) => {
    const defaultEffort = defaultEfforts.get(model.value)
    return {
      value: model.value,
      label: model.displayName,
      description: model.description,
      ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
      efforts: model.supportsEffort ? (model.supportedEffortLevels ?? []) : [],
      ...(defaultEffort ? { defaultEffort } : {}),
      fast: !!model.supportsFastMode,
      autoMode: !!model.supportsAutoMode,
    }
  })
}
