type DiffLine = { readonly kind: "same" | "add" | "del"; readonly text: string }

/** Edits larger than this many lines on either side show as removed-then-added, without matching. */
const MAX_MATCHED_LINES = 400

/** A line diff of two strings, by longest common subsequence. Tool edits are small, so this stays cheap. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : []
  const b = after ? after.split("\n") : []
  if (a.length > MAX_MATCHED_LINES || b.length > MAX_MATCHED_LINES) {
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))]
  }
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! })
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) lines.push({ kind: "del", text: a[i++]! })
    else lines.push({ kind: "add", text: b[j++]! })
  }
  while (i < a.length) lines.push({ kind: "del", text: a[i++]! })
  while (j < b.length) lines.push({ kind: "add", text: b[j++]! })
  return lines
}
