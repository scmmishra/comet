import type { CoreReady } from "@desk/protocol"
import { startCore } from "./server"
import { takeLoginEnvironment } from "./environment"

const token = process.env.DESK_TOKEN
if (!token) {
  console.error("DESK_TOKEN must be set. The Desk app starts the core and sets it.")
  process.exit(1)
}

// The environment is read while the server starts. The app connects only after the line below, so
// nothing the core starts runs before the environment is in place.
const environment = takeLoginEnvironment()
const core = startCore({ token })
await environment
// The app reads the first line of stdout as this, so nothing may print before it.
const ready: CoreReady = { port: core.port }
console.log(JSON.stringify(ready))

// The app owns the core. When the app's end of stdin closes, the app is gone, so the core exits too.
process.stdin.on("end", () => {
  core.stop()
  process.exit(0)
})
process.stdin.resume()
