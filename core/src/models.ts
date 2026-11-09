import type { AccountInfo, ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk"
import { DEFAULT_MODEL, type ClaudeAccount, type Effort, type ModelOption } from "@desk/protocol"
import { probe } from "./probe"

/**
 * The SDK's settings read, which it ships without a type. `applied.effort` is the effort the next
 * message would use. Desk only reads it, so a change to it costs the Default label, not a session.
 */
type SettingsReader = { getSettings(): Promise<{ applied?: { effort?: Effort | null } }> }

/**
 * The models Claude Code offers this account, in its order, and the account itself. `publish` gets the
 * list as soon as the query starts, then again with each model's default effort, which takes seconds to read.
 */
export async function probeModels(dir: string, publish: (models: ModelOption[]) => void, onAccount: (account: ClaudeAccount | undefined) => void): Promise<void> {
  await probe(dir, async (running) => {
    const { models, account } = await running.initializationResult()
    onAccount(claudeAccount(account))
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

/** The account as Desk shows it. Claude Code reports an empty account when no one is signed in. */
export function claudeAccount(account: AccountInfo | undefined): ClaudeAccount | undefined {
  if (!account || (!account.email && !account.apiKeySource && (!account.apiProvider || account.apiProvider === "firstParty"))) return undefined
  return {
    ...(account.email ? { email: account.email } : {}),
    ...(account.organization ? { organization: account.organization } : {}),
    ...(account.subscriptionType ? { plan: account.subscriptionType } : {}),
    ...(account.apiProvider ? { apiProvider: account.apiProvider } : {}),
    ...(account.apiKeySource ? { apiKeySource: account.apiKeySource } : {}),
  }
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
