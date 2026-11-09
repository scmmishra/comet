import type { CoreReady } from "@desk/protocol"
import { startCore } from "./server"

/**
 * What Claude Code sets for the processes it starts. A Desk started from inside a Claude Code session
 * inherits them, and the sessions Desk starts would take themselves for children of that session:
 * Claude Code then stops saving their transcripts, so they cannot be resumed. Rune hit the same issue.
 */
const AGENT_SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
]
for (const name of AGENT_SESSION_MARKERS) delete process.env[name]

const token = process.env.DESK_TOKEN
const dir = process.env.DESK_DIR
if (!token || !dir) {
  console.error("DESK_TOKEN and DESK_DIR must be set. The Desk app starts the core and sets them.")
  process.exit(1)
}

const core = startCore({ token, dir })
const ready: CoreReady = { ready: true, port: core.port }
console.log(JSON.stringify(ready))

// The app owns the core. When the app's end of stdin closes, the app is gone, so the core exits too.
process.stdin.on("end", () => {
  core.stop()
  process.exit(0)
})
process.stdin.resume()
