/**
 * Codex runs each command through a login shell, as `/bin/zsh -lc '<script>'`, and quotes the script in
 * pieces such as `"a "'`b`'" c"`. These patterns are T3 Code's.
 */
const SHELL_WRAPPER = /^\s*(?:\S*\/)?(?:ba|z|da|k)?sh\s+-l?c\s+(?=["'])([\s\S]*)$/
const SHELL_WORD_PIECE = /"((?:\\[\s\S]|[^"\\])*)"|'([^']*)'|\\([\s\S])|(\S)/g

/** The script a command runs, without Codex's shell around it. A command with no shell around it passes through. */
export function shellScript(command: string): string {
  const wrapped = SHELL_WRAPPER.exec(command)?.[1]
  if (wrapped === undefined) return command
  return Array.from(wrapped.matchAll(SHELL_WORD_PIECE), ([, double, single, escaped, bare]) => double?.replace(/\\(["\\$`])/g, "$1") ?? single ?? escaped ?? bare).join("")
}

/** The script of a command given as words, as Codex's older approvals give it: `["/bin/zsh", "-lc", "<script>"]`. */
export function scriptOfWords(words: readonly string[]): string {
  const [shell, flag, script] = words
  return words.length === 3 && /(?:^|\/)(?:ba|z|da|k)?sh$/.test(shell!) && /^-l?c$/.test(flag!) ? script! : words.join(" ")
}
