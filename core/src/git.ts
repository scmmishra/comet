/** Runs git in `dir` and returns its output. It throws with git's message when git fails. */
export async function git(dir: string, args: readonly string[], env: Record<string, string> = {}): Promise<string> {
  // Desk never takes Git's optional locks, which would get in the way of the user's own git. Snapshots write only objects and a temporary index.
  const child = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...env } })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${error.trim()}`)
  return output
}

/** One line of `git diff --numstat`: its counts and the rest of the line. Binary files show "-" for both counts. */
export function numstatLine(line: string): { additions: number; deletions: number; path: string } {
  const [added, removed, ...path] = line.split("\t")
  return { additions: Number(added) || 0, deletions: Number(removed) || 0, path: path.join("\t") }
}
