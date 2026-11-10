import type { Step, StepGroup, ThreadRow } from "@desk/protocol"
import type { Item } from "./threads"

/** A run of steps with the steps themselves, as the thread draws it. */
export type Group = { readonly type: "group"; readonly id: string; readonly steps: Step[]; readonly live: boolean; readonly summary: string }
/** A finished turn's work, folded into one row. A turn restored without timing has no duration. */
export type Fold<T> = { readonly type: "fold"; readonly id: string; readonly rows: (T | Group)[]; readonly durationMs?: number; readonly stopped: boolean }
/** The head of a running turn. `since` is when its message was sent. */
export type Working = { readonly type: "working"; readonly id: string; readonly since?: number }
export type Row<T> = T | Group | Fold<T> | Working

type NotStep = Exclude<Item, Step>

/**
 * The core's rows with their items in place of ids. The core lays the rows out, so both apps show the
 * same thread. An id whose item has not arrived yet is left out until it does.
 */
export function resolveRows(rows: readonly ThreadRow[], items: readonly Item[]): Row<NotStep>[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const group = (row: StepGroup): Group | undefined => {
    const steps = row.steps.flatMap((id) => (byId.get(id) as Step | undefined) ?? [])
    return steps.length ? { type: "group", id: row.id, steps, live: row.live, summary: row.summary } : undefined
  }
  const item = (id: string) => byId.get(id) as NotStep | undefined
  const found = <T,>(value: T | undefined): T[] => (value === undefined ? [] : [value])
  return rows.flatMap((row): Row<NotStep>[] => {
    if (row.type === "item") return found(item(row.id))
    if (row.type === "group") return found(group(row))
    if (row.type === "working") return [row]
    const inner = row.rows.flatMap((each): (NotStep | Group)[] => (each.type === "item" ? found(item(each.id)) : found(group(each))))
    return [{ type: "fold", id: row.id, rows: inner, ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }), stopped: row.stopped }]
  })
}
