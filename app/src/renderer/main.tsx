import "./index.css"
import { render } from "solid-js/web"
import { App } from "./app"
import { core } from "./core"

void core.connect()
render(() => <App />, document.getElementById("root")!)
