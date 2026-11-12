import { spawn } from "./environment"

/** How long a git command may run before Desk stops it, after T3 Code. */
const TIMEOUT_MS = 30_000

/** Ways a git command runs. `maxBytes` caps what Desk reads of its output. */
export interface GitOptions {
  readonly env?: Record<string, string>
  readonly maxBytes?: number
  /** Past `maxBytes`, "truncate" ends the output with a marker, and "error" fails. Defaults to "error". */
  readonly overflow?: "truncate" | "error"
  /** Written to git's standard input. */
  readonly input?: string
}

/** Ends output cut at its cap. */
export const TRUNCATED = "\n\n[truncated]"

/**
 * Runs git in `dir` and returns its output. It throws with git's message when git fails, runs too long or
 * prints more than its cap allows.
 */
export async function git(dir: string, args: readonly string[], options: GitOptions = {}): Promise<string> {
  const stdin = options.input === undefined ? "ignore" : new Blob([options.input])
  const child = spawn(["git", ...args], { cwd: dir, stdin, stdout: "pipe", stderr: "pipe", env: gitEnv(options.env), timeout: TIMEOUT_MS })
  const [read, error, code] = await Promise.all([readCapped(child.stdout, options.maxBytes), new Response(child.stderr).text(), child.exited])
  if (read.overflowed) {
    if (options.overflow !== "truncate") throw new Error(`git ${args[0]} printed more than ${options.maxBytes} bytes.`)
    return read.text + TRUNCATED
  }
  if (child.signalCode) throw new Error(`git ${args[0]} took longer than ${TIMEOUT_MS / 1000} s.`)
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${error.trim()}`)
  return read.text
}

/**
 * What Desk adds to git's environment. `spawn` adds it to the core's own.
 * - Desk never takes Git's optional locks, which would get in the way of the user's own git.
 * - A bare repository inside a project is never used on its own, after T3 Code. Its config could
 *   otherwise run a command, such as `core.fsmonitor`, when Desk reads the project.
 * Git reads config from the environment as GIT_CONFIG_COUNT entries, so Desk adds one after any the user set.
 */
function gitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const count = Number(process.env.GIT_CONFIG_COUNT) || 0
  return {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: "safe.bareRepository",
    [`GIT_CONFIG_VALUE_${count}`]: "explicit",
    ...extra,
  }
}

/** Reads a stream up to `maxBytes`, cut on a character boundary, and says whether there was more. */
async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes = Infinity): Promise<{ text: string; overflowed: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    if (size + chunk.length > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - size))
      // Leaving the loop cancels the stream, so git stops on a closed pipe instead of writing the rest.
      return { text: new TextDecoder().decode(Buffer.concat(chunks)).replace(/\uFFFD+$/, ""), overflowed: true }
    }
    chunks.push(chunk)
    size += chunk.length
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), overflowed: false }
}
