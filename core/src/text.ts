/** The first line of a text, trimmed. */
export const firstLine = (text: string) => text.trim().split("\n")[0]!.trim()

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
/** How far before a cut `textStart` looks for the start of a character. A longer character is cut between code points. */
const CHARACTER_WINDOW = 32

/**
 * The start of a text, at most `limit` UTF-16 units long, ending between whole characters. A plain slice can
 * split an emoji's surrogate pair, and the client rejects a message whose JSON holds half of one. It reads only
 * the characters near the cut, so a long text costs no more than a short one.
 */
export function textStart(text: string, limit: number): string {
  if (text.length <= limit) return text
  const from = Math.max(0, limit - CHARACTER_WINDOW)
  let end = from
  for (const { index } of graphemes.segment(text.slice(from, limit + CHARACTER_WINDOW))) {
    if (from + index > limit) break
    end = from + index
  }
  // The window's start may fall inside a character, so a cut there falls back to whole code points.
  if (end === from && from > 0) end = isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit
  return text.slice(0, end)
}

/**
 * The end of a text, at most `limit` UTF-16 units long, starting on a whole code point. It runs on every chunk a
 * terminal prints, so it checks one unit and does not look for whole characters.
 */
export function textEnd(text: string, limit: number): string {
  if (text.length <= limit) return text
  const start = text.length - limit
  return text.slice(isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start)
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff
