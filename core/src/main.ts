import type { CoreReady } from "@desk/protocol"
import { startCore } from "./server"

const token = process.env.DESK_TOKEN
if (!token) {
  console.error("DESK_TOKEN is not set. The Desk app starts the core and sets it.")
  process.exit(1)
}

const core = startCore(token)
const ready: CoreReady = { ready: true, port: core.port }
console.log(JSON.stringify(ready))

// The app owns the core. When the app's end of stdin closes, the app is gone, so the core exits too.
process.stdin.on("end", () => {
  core.stop()
  process.exit(0)
})
process.stdin.resume()
