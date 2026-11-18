import type { VisualPart } from "@comet/protocol"

/**
 * The components an agent can show the user, after json-render's catalog. The agent names a component
 * and sends its data, and Comet draws it, so the agent never writes markup. Each component says what it
 * is for, what props it takes, and how its props become a part of the thread. The `show` tool's schema
 * and its checks both come from this list, so they never disagree.
 */
export interface Component {
  /** What it is for, in words the model reads. */
  readonly description: string
  /** Its props beside `type`, as JSON Schema properties. */
  readonly props: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
  /** The part the thread draws for these props. Throws, in words for the model, on props Comet cannot draw. */
  draw(props: Record<string, unknown>): VisualPart
}

/** The forms of chart Comet draws. */
const CHART_FORMS = ["bar", "line"] as const

/**
 * The most labels and values a chart holds, together. Rune's Mermaid charts stop drawing past it and
 * show their source in its place.
 */
const MAX_CHART_ITEMS = 400

/**
 * The longest option an action takes. A press sends the option as the user's message, so its button
 * shows all of it, on one line that fits the thread's column.
 */
const MAX_OPTION_LENGTH = 80

const table: Component = {
  description: "Rows of data under named columns. Every row has one cell for each column. A column of numbers lines up on the right. A text cell takes inline Markdown, such as `code` or a link.",
  props: {
    columns: { type: "array", minItems: 1, items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: ["string", "number", "null"] } } },
  },
  required: ["columns", "rows"],
  draw(props) {
    const columns = list(props.columns, "A table's `columns`").map((column, index) => text(column, `Column ${index + 1}`))
    if (!columns.length) throw new Error("A table needs at least one column.")
    const rows = list(props.rows, "A table's `rows`").map((row, index) => {
      const cells = list(row, `Row ${index + 1}`)
      if (cells.length !== columns.length) throw new Error(`Row ${index + 1} has ${cells.length} cells for ${columns.length} columns. Give one cell for each column, or null for an empty one.`)
      return cells.map((cell) => (cell === null || typeof cell === "string" || isNumber(cell) ? cell : fail(`Row ${index + 1}'s cells are text, numbers or null.`)))
    })
    // A column reads as numbers when it holds at least one, and nothing but numbers and empty cells.
    const numeric = columns.map((_, at) => rows.some((row) => typeof row[at] === "number") && rows.every((row) => typeof row[at] !== "string"))
    const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`
    const lines = [line(columns.map(tableCell)), line(numeric.map((right) => (right ? "--:" : ":--"))), ...rows.map((row) => line(row.map((cell) => (cell === null ? "" : tableCell(String(cell))))))]
    return { type: "markdown", text: lines.join("\n") }
  },
}

const chart: Component = {
  description:
    "Amounts across labels. `bar` compares amounts. `line` shows change along ordered labels, such as days. Every series has one value for each label. All series share one axis, so measures on different scales go in separate charts.",
  props: {
    form: { type: "string", enum: CHART_FORMS },
    labels: { type: "array", minItems: 1, items: { type: "string" }, description: "The categories or points along the chart, in order." },
    series: {
      type: "array",
      minItems: 1,
      items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"], additionalProperties: false },
    },
    unit: { type: "string", description: "What the values measure, such as `ms` or `Replies`. It names the value axis." },
  },
  required: ["form", "labels", "series"],
  draw(props) {
    const form = CHART_FORMS.find((known) => known === props.form) ?? fail(`A chart's \`form\` is one of: ${CHART_FORMS.join(", ")}.`)
    const labels = list(props.labels, "A chart's `labels`").map((label, index) => (isNumber(label) ? String(label) : text(label, `Label ${index + 1}`)))
    if (!labels.length) throw new Error("A chart needs at least one label.")
    const series = list(props.series, "A chart's `series`").map((entry, index) => {
      const fields = record(entry, `Series ${index + 1}`)
      const name = text(fields.name, `Series ${index + 1}'s \`name\``)
      const values = list(fields.values, `${name}'s \`values\``).map((value) => (isNumber(value) ? value : fail(`${name}'s values are numbers.`)))
      if (values.length !== labels.length) throw new Error(`${name} has ${values.length} values for ${labels.length} labels. Give one value for each label.`)
      return { name, values }
    })
    if (!series.length) throw new Error("A chart needs at least one series.")
    if (labels.length * (series.length + 1) > MAX_CHART_ITEMS) throw new Error(`A chart holds at most ${MAX_CHART_ITEMS} labels and values together. Use fewer labels or fewer series, or show the data as a table.`)
    const unit = optionalText(props.unit)
    const lines = [
      "xychart-beta",
      `    x-axis [${labels.map(quoted).join(", ")}]`,
      ...(unit ? [`    y-axis ${quoted(unit)}`] : []),
      ...series.map(({ name, values }) => `    ${form} ${quoted(name)} [${values.join(", ")}]`),
    ]
    return { type: "markdown", text: mermaid(lines.join("\n")) }
  },
}

const diagram: Component = {
  description: "A Mermaid diagram, such as a flowchart, a sequence diagram, a state diagram or an ER diagram. Use it for structure and flow, not for amounts.",
  props: { mermaid: { type: "string", description: "The diagram's Mermaid source, starting with its type, such as `flowchart TD`." } },
  required: ["mermaid"],
  draw: (props) => ({ type: "markdown", text: mermaid(text(props.mermaid, "A diagram's `mermaid`")) }),
}

const actions: Component = {
  description: `Buttons for what the user may want next. A press sends the option's text to you as the user's next message, so write each option as the user would say it, in a few words. At most ${MAX_OPTION_LENGTH} characters each.`,
  props: { options: { type: "array", minItems: 1, items: { type: "string" } } },
  required: ["options"],
  draw(props) {
    const options = list(props.options, "The actions' `options`").map((option, index) => {
      const words = text(option, `Option ${index + 1}`).replace(/\s+/g, " ")
      if (words.length > MAX_OPTION_LENGTH) throw new Error(`Option ${index + 1} has ${words.length} characters. An option fits a button: at most ${MAX_OPTION_LENGTH}, in a few words.`)
      return words
    })
    if (!options.length) throw new Error("Actions need at least one option.")
    return { type: "actions", options }
  },
}

/** The catalog, by the name an agent gives a part's `type`. */
export const CATALOG: Readonly<Record<string, Component>> = { table, chart, diagram, actions }

const fail = (message: string): never => {
  throw new Error(message)
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

export function list(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? value : fail(`${what} is a list.`)
}

export function record(value: unknown, what: string): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fail(`${what} is an object.`)
}

function text(value: unknown, what: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fail(`${what} is text that is not empty.`)
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** Text as one cell of a Markdown table: a bar would end the cell and a line break the row. */
const tableCell = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ")

/** Text as a quoted Mermaid label. A quote would end the label, and a bracket the list it sits in. */
const quoted = (label: string) => `"${label.replace(/"/g, "'").replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s*\n\s*/g, " ")}"`

/** Mermaid source as a fenced block, with a fence longer than any run of backticks inside it. */
function mermaid(source: string): string {
  const longest = Math.max(2, ...(source.match(/`+/g) ?? []).map((run) => run.length))
  const fence = "`".repeat(longest + 1)
  return `${fence}mermaid\n${source}\n${fence}`
}
