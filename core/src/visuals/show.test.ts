import { expect, test } from "bun:test"
import { CATALOG } from "./catalog"
import { SHOW, SHOW_TOOLS, shownVisual, visualItem } from "./show"

test("offers every part of the catalog in the tool's schema and its description", () => {
  const part = (SHOW.inputSchema.properties as { parts: { items: { properties: Record<string, { enum?: string[] }> } } }).parts.items.properties
  expect(part.type!.enum).toEqual(Object.keys(CATALOG))
  // Parts share one flat schema, so no two kinds may name a prop alike.
  const props = Object.values(CATALOG).flatMap((component) => Object.keys(component.props))
  expect(Object.keys(part)).toEqual(["type", ...props])
  expect(new Set(props).size).toBe(props.length)
  expect(SHOW.description).toContain("- `table`, with `columns` and `rows`: Rows of data")
  expect(SHOW.description).toContain("- `chart`, with `form` and `labels` and `series`, and `unit` if it helps: Amounts across labels.")
})

test("draws a table as a Markdown table, with its columns of numbers on the right", () => {
  const visual = shownVisual({ title: " Slow queries ", parts: [{ type: "table", columns: ["Query", "Calls", "Note"], rows: [["users | email", 1200, null], ["orders\nby day", null, "ok"]] }] })
  expect(visual).toEqual({ title: "Slow queries", parts: [{ type: "markdown", text: "| Query | Calls | Note |\n| :-- | --: | :-- |\n| users \\| email | 1200 |  |\n| orders by day |  | ok |" }] })
})

test("draws a chart as a Mermaid XY chart, with labels that cannot end their list", () => {
  const [part] = shownVisual({ parts: [{ type: "chart", form: "line", labels: ["Mon", 'T"u[e]'], series: [{ name: "Replies", values: [3, 4.5] }], unit: "ms" }] }).parts
  expect(part).toEqual({ type: "markdown", text: '```mermaid\nxychart-beta\n    x-axis ["Mon", "T\'u(e)"]\n    y-axis "ms"\n    line "Replies" [3, 4.5]\n```' })
})

test("fences a diagram past the backticks in its source, and passes actions through", () => {
  const { parts } = shownVisual({ parts: [{ type: "diagram", mermaid: "flowchart TD\n  A[```x```] --> B" }, { type: "actions", options: [" Fix it ", "Show\nlast  week"] }] })
  expect(parts[0]).toEqual({ type: "markdown", text: "````mermaid\nflowchart TD\n  A[```x```] --> B\n````" })
  expect(parts[1]).toEqual({ type: "actions", options: ["Fix it", "Show last week"] })
})

test("tells the model what is wrong with input it cannot draw", () => {
  const wrong = (parts: unknown) => {
    try {
      shownVisual({ parts } as Record<string, unknown>)
    } catch (error) {
      return (error as Error).message
    }
    return "drew"
  }
  expect(wrong(undefined)).toBe("`parts` is a list.")
  expect(wrong([])).toBe("`parts` needs at least one part.")
  expect(wrong([{ type: "html" }])).toBe("Part 1's `type` is one of: table, chart, diagram, actions.")
  expect(wrong([{ type: "toString" }])).toBe("Part 1's `type` is one of: table, chart, diagram, actions.")
  expect(wrong([{ type: "table", columns: ["A", "B"], rows: [[1]] }])).toBe("Row 1 has 1 cells for 2 columns. Give one cell for each column, or null for an empty one.")
  expect(wrong([{ type: "chart", form: "pie", labels: ["a"], series: [] }])).toBe("A chart's `form` is one of: bar, line.")
  expect(wrong([{ type: "chart", form: "bar", labels: ["a", "b"], series: [{ name: "Calls", values: [1] }] }])).toBe("Calls has 1 values for 2 labels. Give one value for each label.")
  expect(wrong([{ type: "chart", form: "bar", labels: ["a"], series: [{ name: "Calls", values: [null] }] }])).toBe("Calls's values are numbers.")
  const labels = Array.from({ length: 201 }, (_, index) => `d${index}`)
  expect(wrong([{ type: "chart", form: "bar", labels, series: [{ name: "Calls", values: labels.map(() => 1) }] }])).toStartWith("A chart holds at most 400 labels and values together.")
  expect(wrong([{ type: "actions", options: [] }])).toBe("Actions need at least one option.")
  expect(wrong([{ type: "actions", options: ["x".repeat(81)] }])).toBe("Option 1 has 81 characters. An option fits a button: at most 80, in a few words.")
})

test("answers a call at once, and makes a thread item only of a show call it can draw", async () => {
  const input = { parts: [{ type: "actions", options: ["Go on"] }] }
  const signal = new AbortController().signal
  expect(await SHOW_TOOLS.call("show", input, signal)).toEqual({ text: "Shown to the user, above your reply." })
  expect(SHOW_TOOLS.call("show", { parts: [] }, signal)).rejects.toThrow("`parts` needs at least one part.")
  expect(visualItem("t1", "show", input)).toEqual({ type: "visual", id: "t1", parts: [{ type: "actions", options: ["Go on"] }] })
  expect(visualItem("t1", "show", { parts: [] })).toBeUndefined()
  expect(visualItem("t1", "delegate", input)).toBeUndefined()
  expect(visualItem("t1", "show", null)).toBeUndefined()
})
