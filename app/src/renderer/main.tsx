import "./index.css"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { render } from "solid-js/web"
import { App } from "./app"
import { core } from "./core"

void core.connect()
render(
  () => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ),
  document.getElementById("root")!,
)
