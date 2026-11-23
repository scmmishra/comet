import type { ThreadItem, VisualPart } from "@comet/protocol"
import type { CometTool, ToolGroup } from "../tools/tool"
import { CATALOG, list, optionalText, record } from "./catalog"

/**
 * Comet's `show` tool: the agent shows the user a visual, built from the parts in the catalog. The call
 * answers at once, and the thread draws the visual from the call itself, so a restored thread draws it
 * again. One check reads the input, when the call runs and when a thread draws it.
 */

type Visual = Pick<Extract<ThreadItem, { type: "visual" }>, "title" | "parts">

/** What a session is told about the tool. */
const SHOW_INSTRUCTIONS = [
  "Comet can show the user a visual in the thread: a table, a chart, a diagram and buttons, drawn in Comet's own look. Call `show` with the data. Comet draws it.",
  "Use it when an answer is easier to read as a visual than as text: rows of data, amounts to compare, change over time, or how parts connect. Do not write a Markdown table or a Mermaid block in your reply for these.",
  "The visual shows above your reply. Do not repeat its data in the reply. Say what it shows and what it means.",
].join("\n")

/** What a call answers. The thread draws the visual, so the model has nothing more to read. */
const SHOWN = "Shown to the user, above your reply."

/** The props a part may leave out, in words, such as ", and `unit` if it helps". */
const optional = (component: (typeof CATALOG)[string]) => {
  const names = Object.keys(component.props).filter((prop) => !component.required.includes(prop))
  return names.length ? `, and ${names.map((prop) => `\`${prop}\``).join(" and ")} if it helps` : ""
}

export const SHOW: CometTool = {
  name: "show",
  description: `Shows the user a visual above your reply. Its parts draw in order, top to bottom. The kinds of part:\n${Object.entries(CATALOG)
    .map(([name, component]) => `- \`${name}\`, with ${component.required.map((prop) => `\`${prop}\``).join(" and ")}${optional(component)}: ${component.description}`)
    .join("\n")}`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A few words that name what the visual shows." },
      parts: {
        type: "array",
        minItems: 1,
        // One flat object for every kind of part, since not every agent passes a schema of alternatives on to its model.
        // The description says which props a kind takes, and `shownVisual` checks them.
        items: {
          type: "object",
          properties: { type: { type: "string", enum: Object.keys(CATALOG) }, ...Object.assign({}, ...Object.values(CATALOG).map((component) => component.props)) },
          required: ["type"],
        },
      },
    },
    required: ["parts"],
    additionalProperties: false,
  },
  // A visual draws in place of its call. Only a call Comet could not draw shows as a row.
  summary: (input) => (typeof input.title === "string" ? input.title : ""),
  label: (summary, done) => `${done ? "Tried to show" : "Showing"} ${summary || "a visual"}`,
}

/** The visual a `show` call carries. Throws, in words for the model, on input Comet cannot draw. */
export function shownVisual(input: Record<string, unknown>): Visual {
  const parts = list(input.parts, "`parts`").map((entry, index): VisualPart => {
    const { type, ...props } = record(entry, `Part ${index + 1}`)
    const component = typeof type === "string" && Object.hasOwn(CATALOG, type) ? CATALOG[type] : undefined
    if (!component) throw new Error(`Part ${index + 1}'s \`type\` is one of: ${Object.keys(CATALOG).join(", ")}.`)
    return component.draw(props)
  })
  if (!parts.length) throw new Error("`parts` needs at least one part.")
  const title = optionalText(input.title)
  return { ...(title ? { title } : {}), parts }
}

/** The `show` tool, for a session whose thread draws a `show` call as its visual. The call answers at once. */
export const SHOW_TOOLS: ToolGroup = {
  instructions: SHOW_INSTRUCTIONS,
  tools: [SHOW],
  call: async (_, input) => {
    shownVisual(input)
    return { text: SHOWN }
  },
}

/** The thread item a call of one of Comet's tools draws in place of its row: a `show` call Comet can draw. Undefined for any other call. */
export function visualItem(id: string, tool: string, input: unknown): Extract<ThreadItem, { type: "visual" }> | undefined {
  if (tool !== SHOW.name || typeof input !== "object" || input === null) return undefined
  try {
    return { type: "visual", id, ...shownVisual(input as Record<string, unknown>) }
  } catch {
    return undefined
  }
}
