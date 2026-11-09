/**
 * The user's login shell, with the arguments that run `command` in it. The core may start without
 * the user's PATH, such as from the Dock, so commands run in a login shell that reads their profile.
 * Without a command, the shell is interactive.
 */
export function loginShell(command?: string): string[] {
  const shell = process.env.SHELL || "/bin/zsh"
  return command === undefined ? [shell, "-l"] : [shell, "-l", "-c", command]
}
