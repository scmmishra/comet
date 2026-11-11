import type { TextEdit } from "@desk/protocol"
import type { FileUpdate } from "./protocol"

/**
 * The edits of one file a Codex patch changed. Codex gives an added or deleted file's whole text, and a
 * unified diff for an update. Each hunk of the diff is one edit: its removed lines are the text before,
 * and its added lines the text after. Context lines belong to neither.
 */
export function fileEdits(change: FileUpdate): TextEdit[] {
  if (change.kind.type === "add") return [{ before: "", after: change.diff }]
  if (change.kind.type === "delete") return [{ before: change.diff, after: "" }]
  return hunkEdits(change.diff)
}

function hunkEdits(diff: string): TextEdit[] {
  const edits: TextEdit[] = []
  let hunk: { before: string[]; after: string[] } | undefined
  const close = () => hunk && (hunk.before.length || hunk.after.length) && edits.push({ before: hunk.before.join("\n"), after: hunk.after.join("\n") })
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      close()
      hunk = { before: [], after: [] }
    } else if (!hunk) continue
    else if (line.startsWith("-")) hunk.before.push(line.slice(1))
    else if (line.startsWith("+")) hunk.after.push(line.slice(1))
  }
  close()
  return edits
}
