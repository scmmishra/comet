import type { AccountInfo, EffortLevel, ModelInfo, Query } from "@anthropic-ai/claude-agent-sdk"
import { DEFAULT_MODEL, PERMISSION_MODES, type AgentAccount, type Effort, type ModelOption, type PermissionMode } from "@comet/protocol"

/** A model pinned to one version, such as "claude-opus-4-8". An alias such as "opus" follows the newest of its family. */
const PINNED = /^claude-/
/** The permission modes every Claude model takes. Auto needs a model that supports it. */
const MODES_WITHOUT_AUTO: readonly PermissionMode[] = PERMISSION_MODES.filter((mode) => mode !== "auto")

/**
 * The SDK's settings read, which it ships without a type. `applied.effort` is the effort the next
 * message would use. Comet only reads it, so a change to it costs the Default label, not a session.
 */
type SettingsReader = { getSettings(): Promise<{ applied?: { effort?: Effort | null } }> }

/** Claude Code's default model is the absence of a model option. */
export const sdkModel = (model: string) => (model === DEFAULT_MODEL ? undefined : model)

/** Claude Code names its effort levels itself, and a tab holds one of the levels its model listed. */
export const sdkEffort = (effort: Effort) => effort as EffortLevel

/** Switches the probe's model to each one in turn and reads the effort Claude Code would use. It takes seconds. */
export async function defaultEfforts(running: Query, models: readonly ModelInfo[]): Promise<Map<string, Effort>> {
  const efforts = new Map<string, Effort>()
  for (const model of models) {
    if (!model.supportsEffort) continue
    try {
      await running.setModel(sdkModel(model.value))
      const effort = (await (running as unknown as SettingsReader).getSettings()).applied?.effort
      if (effort) efforts.set(model.value, effort)
    } catch {
      // Without a reading, the picker shows Default with no level beside it.
    }
  }
  return efforts
}

/** The account as Comet shows it. Claude Code reports an empty account when no one is signed in. */
export function claudeAccount(account: AccountInfo | undefined): AgentAccount | undefined {
  if (!account || (!account.email && !account.apiKeySource && (!account.apiProvider || account.apiProvider === "firstParty"))) return undefined
  const method = account.email ? undefined : account.apiKeySource ? `an API key from ${account.apiKeySource}` : account.apiProvider
  return {
    ...(account.email ? { email: account.email } : {}),
    ...(account.organization ? { organization: account.organization } : {}),
    ...(account.subscriptionType ? { plan: account.subscriptionType } : {}),
    ...(method ? { method } : {}),
  }
}

/** The models Claude Code offers the account, in its order, as its /model menu lists them. */
export function modelOptions(models: readonly ModelInfo[], defaultEfforts: ReadonlyMap<string, Effort> = new Map()): ModelOption[] {
  return models.map((model) => {
    const defaultEffort = defaultEfforts.get(model.value)
    const runs = model.resolvedModel ? modelLabel(model.resolvedModel) : undefined
    return {
      value: model.value,
      label: model.displayName,
      description: model.description,
      // "Sonnet" already says it runs Sonnet 5.5. "Default" does not say what it runs.
      ...(runs && !runs.toLowerCase().startsWith(model.displayName.toLowerCase()) ? { runs } : {}),
      efforts: model.supportsEffort ? (model.supportedEffortLevels ?? []) : [],
      ...(defaultEffort ? { defaultEffort } : {}),
      fast: !!model.supportsFastMode,
      permissionModes: model.supportsAutoMode ? PERMISSION_MODES : MODES_WITHOUT_AUTO,
      ...(PINNED.test(model.value) ? { older: true } : {}),
    }
  })
}

/** A Claude model's id as a name: "claude-opus-5-5" reads "Opus 5.5". An id of another shape passes through. */
export function modelLabel(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-|$)/.exec(id)
  if (!match) return id
  const [, family, major, minor] = match
  return `${family![0]!.toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}`
}
