import { DEFAULT_MODEL, PERMISSION_MODES, type ModelOption, type RunSettings } from "@comet/protocol"
import type { CodexModel } from "./protocol"
import type { AppServer } from "./server"

/** The service tier Codex calls Fast. */
const FAST_TIER = "priority"

/**
 * The models Codex offers the account, read once and kept. A turn names its model and effort from
 * them, and Settings lists them.
 */
export class ModelCatalog {
  private models?: Promise<readonly CodexModel[]>

  constructor(private readonly server: AppServer) {}

  /** Reads the models again, page by page. */
  read(): Promise<readonly CodexModel[]> {
    const reading = listModels(this.server)
    this.models = reading.catch(() => {
      this.models = undefined
      return []
    })
    return reading
  }

  /** The models last read, read now if they never were. A failed read gives none, and the next ask reads again. */
  get(): Promise<readonly CodexModel[]> {
    return this.models ?? this.read().catch(() => [])
  }
}

async function listModels(server: AppServer): Promise<CodexModel[]> {
  const models: CodexModel[] = []
  let cursor: string | null = null
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } = await server.request("model/list", cursor ? { cursor } : {})
    models.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return models
}

/** The models as Comet lists them: Codex's default first, then each model Codex shows in its own picker. */
export function modelOptions(models: readonly CodexModel[]): ModelOption[] {
  const fallback = models.find((model) => model.isDefault)
  const shown = models.filter((model) => !model.hidden).map((model) => option(model))
  if (!fallback) return shown
  return [{ ...option(fallback), value: DEFAULT_MODEL, label: "Default", runs: fallback.displayName }, ...shown]
}

function option(model: CodexModel): ModelOption {
  return {
    value: model.id,
    label: model.displayName,
    description: model.description,
    efforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    defaultEffort: model.defaultReasoningEffort,
    fast: model.serviceTiers.some((tier) => tier.id === FAST_TIER),
    permissionModes: PERMISSION_MODES,
  }
}

/** The model, effort and speed a turn runs with, as `turn/start` takes them. */
export interface TurnModel {
  readonly model?: string
  readonly effort?: string
  /** Null runs at standard speed. */
  readonly serviceTier: string | null
}

/**
 * What a turn runs with. Codex keeps a turn's model, effort and tier for the turns after it, so each
 * turn names all three. Otherwise a tab set back to Default would keep the model it had before. Default
 * names the model Codex marks as its default, which is the one Comet shows Default runs. An effort the
 * tab leaves unset is the model's default effort.
 */
export function turnModel(models: readonly CodexModel[], settings: RunSettings): TurnModel {
  const chosen = settings.model === DEFAULT_MODEL ? models.find((model) => model.isDefault) : models.find((model) => model.id === settings.model)
  const model = chosen?.id ?? (settings.model === DEFAULT_MODEL ? undefined : settings.model)
  const effort = settings.effort ?? chosen?.defaultReasoningEffort
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), serviceTier: settings.fast ? FAST_TIER : null }
}

/** A model's name as Comet shows it, such as "GPT-6-Sol". An unknown id passes through. */
export const modelName = (models: readonly CodexModel[], id: string) => models.find((model) => model.id === id)?.displayName ?? id
