import "./index.css"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { render } from "solid-js/web"
import { App } from "./app"
import { applyAppearance } from "./appearance"
import { core } from "./core"

void core.connect()
applyAppearance()
render(
  () => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ),
  document.getElementById("root")!,
)
