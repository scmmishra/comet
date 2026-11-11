/**
 * The user's login shell, with the arguments that run `command` in it. The core may start without
 * the user's PATH, such as from the Dock, so commands run in a login shell that reads their profile.
 * Without a command, the shell is interactive.
 */
export function loginShell(command?: string): string[] {
  const shell = process.env.SHELL || "/bin/zsh"
  return command === undefined ? [shell, "-l"] : [shell, "-l", "-c", command]
}

let loginPath: Promise<string> | undefined

/** The login shell's PATH, read once. The core takes it as its own at start (`main.ts`), so all it runs finds the user's tools. */
export function loginShellPath(): Promise<string> {
  loginPath ??= (async () => {
    const child = Bun.spawn(loginShell('printf %s "$PATH"'), { stdout: "pipe", stderr: "ignore" })
    const path = (await new Response(child.stdout).text()).trim()
    return path || process.env.PATH || ""
  })()
  return loginPath
}
