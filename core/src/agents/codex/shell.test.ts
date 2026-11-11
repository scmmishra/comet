import { expect, test } from "bun:test"
import { scriptOfWords, shellScript } from "./shell"

test("shows the script inside Codex's login shell, however Codex quoted it", () => {
  expect(shellScript(`/bin/zsh -lc 'npm test'`)).toBe("npm test")
  expect(shellScript(`/bin/bash -lc "printf '%s' 'fixture' > out.txt"`)).toBe("printf '%s' 'fixture' > out.txt")
  expect(shellScript("/bin/zsh -lc \"echo \"'`date`'\" done\"")).toBe("echo `date` done")
  expect(shellScript("git status")).toBe("git status")
})

test("reads the script of a command given as words", () => {
  expect(scriptOfWords(["/bin/zsh", "-lc", "rg foo"])).toBe("rg foo")
  expect(scriptOfWords(["git", "status"])).toBe("git status")
})
