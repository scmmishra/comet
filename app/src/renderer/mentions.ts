/** The @ mention the caret is in: an @ at the start or after a space, then the path typed so far. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return match ? { start: caret - match[1]!.length - 1, query: match[1]! } : undefined
}

/** `text` with the mention at `start` replaced by `@path` and a space, and where the caret goes after it. */
export function insertMention(text: string, start: number, caret: number, path: string): { text: string; caret: number } {
  const inserted = `@${path} `
  const after = text.slice(caret).replace(/^\s/, "")
  return { text: text.slice(0, start) + inserted + after, caret: start + inserted.length }
}
