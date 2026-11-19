import type { CoreReady } from "@comet/protocol"
import { startCore } from "./server"
import { takeLoginEnvironment } from "./login-environment"
import { bundledCommand, linkCommand } from "./command-line-tool"

const token = process.env.COMET_TOKEN
if (!token) {
  console.error("COMET_TOKEN must be set. The Comet app starts the core and sets it.")
  process.exit(1)
}

// The environment is read while the server starts. The app connects only after the line below, so
// nothing the core starts runs before the environment is in place. From the cache, it is in place at once.
const environment = takeLoginEnvironment()
// A Comet installed from a release runs no install script, so it puts its `comet` command on the PATH here.
// The command is a convenience, so a failure, such as a folder it cannot write, never stops Comet.
const command = bundledCommand()
if (command) {
  try {
    linkCommand(command)
  } catch (error) {
    console.error(`Comet could not link the comet command: ${error instanceof Error ? error.message : error}`)
  }
}
const core = startCore({ token })
await environment.ready
// The app reads the first line of stdout as this, so nothing may print before it.
const ready: CoreReady = { port: core.port }
console.log(JSON.stringify(ready))

// The app owns the core. When the app's end of stdin closes, the app is gone, so the core exits too.
process.stdin.on("end", () => {
  core.stop()
  process.exit(0)
})
process.stdin.resume()
