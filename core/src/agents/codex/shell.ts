/**
 * Codex runs each command through a login shell, as `/bin/zsh -lc '<script>'`, and quotes the script in
 * pieces such as `"a "'`b`'" c"`. These patterns are T3 Code's.
 */
const SHELL_NAME = String.raw`(?:ba|z|da|k)?sh`
const SHELL_FLAG = String.raw`-l?c`
const SHELL_WRAPPER = new RegExp(String.raw`^\s*(?:\S*/)?${SHELL_NAME}\s+${SHELL_FLAG}\s+(?=["'])([\s\S]*)$`)
const SHELL_PATH = new RegExp(String.raw`(?:^|/)${SHELL_NAME}$`)
const SHELL_FLAG_WORD = new RegExp(`^${SHELL_FLAG}$`)
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
  return words.length === 3 && SHELL_PATH.test(shell!) && SHELL_FLAG_WORD.test(flag!) ? script! : words.join(" ")
}
