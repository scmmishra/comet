import { getSharedHighlighter, type DiffsHighlighter, type SupportedLanguages } from "@pierre/diffs"

/**
 * Syntax highlighting for code blocks, set up the way T3 Code does it: @pierre/diffs' shared
 * highlighter with its WASM lexers, one cached load per language, and a cache of finished blocks.
 */
/** Both themes at once: each token carries a colour for each, as CSS variables, and the page's theme picks one. Review's diffs use the same pair. */
export const CODE_THEMES = { light: "pierre-light", dark: "pierre-dark" } as const
const PLAIN = "text"
const MAX_CACHED_BLOCKS = 300

const highlighters = new Map<string, Promise<DiffsHighlighter>>()
const blocks = new Map<string, string>()

function highlighterFor(language: string): Promise<DiffsHighlighter> {
  const cached = highlighters.get(language)
  if (cached) return cached
  const promise = getSharedHighlighter({
    themes: [CODE_THEMES.light, CODE_THEMES.dark],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "highlights",
  }).catch((error) => {
    if (language === PLAIN) {
      highlighters.delete(language)
      throw error
    }
    // An unknown language falls back to plain text.
    return highlighterFor(PLAIN)
  })
  highlighters.set(language, promise)
  return promise
}

/** The highlighted inner HTML of a code element: lines of coloured spans, without the <pre>. */
export async function highlight(code: string, language: string): Promise<string> {
  const key = `${language}\0${code}`
  const cached = blocks.get(key)
  if (cached !== undefined) return cached

  const highlighter = await highlighterFor(language)
  let html: string
  try {
    html = highlighter.codeToHtml(code, { lang: language, themes: CODE_THEMES, defaultColor: false })
  } catch {
    // The highlighter may hold only the plain lexer, when the language's failed to load.
    html = highlighter.codeToHtml(code, { lang: PLAIN, themes: CODE_THEMES, defaultColor: false })
  }
  const inner = html.slice(html.indexOf(">", html.indexOf("<code")) + 1, html.lastIndexOf("</code>"))

  if (blocks.size >= MAX_CACHED_BLOCKS) blocks.delete(blocks.keys().next().value!)
  blocks.set(key, inner)
  return inner
}
