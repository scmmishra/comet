import { DEFAULT_MODEL, type Effort, type ModelOption } from "@desk/protocol"
import { existsSync, readFileSync } from "node:fs"
import { writeJsonFile } from "../../data-files"
import { choices, modelOption, thoughtOption } from "../acp/config-options"
import type { ConfigOption, SelectChoice } from "../acp/protocol"
import { ANTIGRAVITY_MODES } from "./modes"

/** The models a session last reported, the one it ran by default, and the thinking levels of each model seen selected. */
interface CachedModels {
  readonly current?: string
  readonly models: readonly SelectChoice[]
  readonly efforts: Readonly<Record<string, readonly Effort[]>>
}

/**
 * The models Antigravity offers the account, kept in a file so the picker has them before a session runs.
 * The agent lists a model's thinking levels only while that model is selected, so the cache learns each
 * model's levels as sessions select it.
 */
export class ModelCache {
  constructor(private readonly path: () => string) {}

  /**
   * Takes what a session reported, and answers the models as Desk lists them. Settings without a model
   * change nothing. Only `opened` settings say which model the account runs by default.
   */
  learn(options: readonly ConfigOption[], opened: boolean): ModelOption[] {
    const model = modelOption(options)
    if (!model || typeof model.currentValue !== "string") return this.options()
    const thought = thoughtOption(options)
    const cached = this.read()
    const efforts = { ...cached.efforts, [model.currentValue]: thought ? choices(thought).map((choice) => choice.value) : [] }
    const current = opened ? model.currentValue : cached.current
    writeJsonFile(this.path(), { ...(current ? { current } : {}), models: choices(model), efforts } satisfies CachedModels)
    return this.options()
  }

  /** The models as Desk lists them, with Antigravity's default first. */
  options(): ModelOption[] {
    return modelOptions(this.read())
  }

  private read(): CachedModels {
    return existsSync(this.path()) ? (JSON.parse(readFileSync(this.path(), "utf8")) as CachedModels) : { models: [], efforts: {} }
  }
}

/** The cached models as Desk lists them. "Default" names the model the account runs by default. */
function modelOptions({ current, models, efforts }: CachedModels): ModelOption[] {
  const option = (value: string, label: string, description: string): ModelOption => ({ value, label, description, efforts: efforts[value] ?? [], fast: false, permissionModes: ANTIGRAVITY_MODES })
  const runs = models.find((model) => model.value === current)?.name
  return [
    { ...option(DEFAULT_MODEL, "Default", ""), efforts: current ? (efforts[current] ?? []) : [], ...(runs ? { runs } : {}) },
    ...models.map((model) => option(model.value, model.name, model.description ?? "")),
  ]
}
