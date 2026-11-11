/** The user's shell, as their account names it. */
export const userShell = () => process.env.SHELL || "/bin/zsh"

/**
 * The user's login shell, with the arguments that run `command` in it. The core may start without
 * the user's PATH, such as from the Dock, so commands run in a login shell that reads their profile.
 * Without a command, the shell is interactive.
 */
export function loginShell(command?: string): string[] {
  const shell = userShell()
  return command === undefined ? [shell, "-l"] : [shell, "-l", "-c", command]
}
