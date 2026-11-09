import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk"
import type { ModelOption } from "@desk/protocol"
import { probe } from "./probe"

/** The models Claude Code offers this account, in its order, as its /model menu lists them. */
export async function probeModels(dir: string): Promise<ModelOption[] | undefined> {
  return probe(dir, async (running) => modelOptions((await running.initializationResult()).models))
}

export function modelOptions(models: readonly ModelInfo[]): ModelOption[] {
  return models.map((model) => ({
    value: model.value,
    label: model.displayName,
    description: model.description,
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
    efforts: model.supportsEffort ? (model.supportedEffortLevels ?? []) : [],
  }))
}
