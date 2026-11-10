import "./index.css"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { showToast, Toast } from "@opencode/ui/toast"
import { render } from "solid-js/web"
import { App } from "./app"
import { applyAppearance } from "./appearance"
import { core } from "./core"

void core.connect()
applyAppearance()
// The core reports what it could not do, such as a command it refused to save.
core.listen((message) => {
  if (message.type === "error") showToast({ variant: "error", description: message.message })
  else if (message.type === "notice") showToast({ description: message.message })
})
// The main process speaks to the user the same way, such as when ⌘Q waits for a second press.
window.desk.onNotice((message) => showToast({ description: message }))
render(
  () => (
    <DialogProvider>
      <App />
      <Toast.Region />
    </DialogProvider>
  ),
  document.getElementById("root")!,
)
