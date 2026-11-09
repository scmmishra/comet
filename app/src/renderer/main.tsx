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
core.listen((message) => message.type === "error" && showToast({ variant: "error", description: message.message }))
render(
  () => (
    <DialogProvider>
      <App />
      <Toast.Region />
    </DialogProvider>
  ),
  document.getElementById("root")!,
)
