import type { CoreReady } from "@desk/protocol"
import { startCore } from "./server"
import { loginShellPath } from "./shell"

/**
 * What Claude Code sets for the processes it starts. A Desk started from inside a Claude Code session
 * inherits them, and the sessions Desk starts would take themselves for children of that session:
 * Claude Code then stops saving their transcripts, so they cannot be resumed. Rune hit the same issue.
 * Other CLAUDE_ variables, such as CLAUDE_CONFIG_DIR, are the user's own and stay.
 */
const isAgentSessionMarker = (name: string) => name.startsWith("CLAUDE_CODE_") || ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_PLUGIN_DATA"].includes(name)
for (const name of Object.keys(process.env)) if (isAgentSessionMarker(name)) delete process.env[name]

const token = process.env.DESK_TOKEN
if (!token) {
  console.error("DESK_TOKEN must be set. The Desk app starts the core and sets it.")
  process.exit(1)
}

// Desk opened from the Dock or Finder starts with launchd's PATH, which lacks Homebrew, mise and the like, so
// Claude Code's commands could not find gh or cargo, nor Desk find gh or the user's editor. Everything the
// core starts takes the login shell's PATH instead. It is read while the server starts, and the app connects
// only after the line below, so nothing runs before it is in place.
const path = loginShellPath()
const core = startCore({ token })
process.env.PATH = await path
// The app reads the first line of stdout as this, so nothing may print before it.
const ready: CoreReady = { port: core.port }
console.log(JSON.stringify(ready))

// The app owns the core. When the app's end of stdin closes, the app is gone, so the core exits too.
process.stdin.on("end", () => {
  core.stop()
  process.exit(0)
})
process.stdin.resume()
