import type { ConfigOption, SelectChoice } from "./protocol"

/** The option that picks the session's model. Agents mark it by id or by category. */
export const modelOption = (options: readonly ConfigOption[]) => options.find((option) => option.type === "select" && (option.id === "model" || option.category === "model"))

/** The option that picks how much the model thinks. An agent lists it only for a model that has levels. */
export const thoughtOption = (options: readonly ConfigOption[]) => options.find((option) => option.type === "select" && option.category === "thought_level")

/** A select option's choices, with its groups flattened, in the agent's order. */
export const choices = (option: ConfigOption): SelectChoice[] => (option.options ?? []).flatMap((entry) => ("group" in entry ? entry.options : [entry]))

/** The name of a select option's current choice. */
export const currentName = (option: ConfigOption) => choices(option).find((choice) => choice.value === option.currentValue)?.name
