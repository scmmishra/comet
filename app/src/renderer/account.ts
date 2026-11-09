import { DEFAULT_SETTINGS, type ClaudeAccount, type ModelOption, type PlanUsage, type SettingsChange } from "@desk/protocol"
import { createStore } from "solid-js/store"
import { core } from "./core"

/** What the core knows about Desk's settings and the Claude account: its models, its sign-in and its usage. */
const [account, setAccount] = createStore({
  settings: DEFAULT_SETTINGS,
  models: [] as readonly ModelOption[],
  /** Who Claude Code is signed in as. Undefined until read, and when no one is. */
  user: undefined as ClaudeAccount | undefined,
  /** Whether the core has read the account yet, so "not signed in" is not shown while it reads. */
  userRead: false,
  usage: undefined as PlanUsage | undefined,
})
export { account }

/** Changes the named settings. The core saves them and sends them back. */
export function updateSettings(change: SettingsChange) {
  core.send({ type: "settings.update", change })
}

/** The core probes plan usage at most once a minute, so asking often is cheap. */
export function refreshUsage() {
  core.send({ type: "usage.get" })
}

core.listen((message) => {
  if (message.type === "settings") setAccount("settings", message.settings)
  else if (message.type === "models") setAccount("models", message.models)
  else if (message.type === "account") setAccount({ user: message.account, userRead: true })
  else if (message.type === "usage") setAccount("usage", message.usage)
})
core.send({ type: "models.get" })
refreshUsage()

// A hot-swapped copy of this module would start empty, and the core does not send its state again. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
