import { Button } from "@opencode/ui/button"
import { createSignal, onCleanup } from "solid-js"
import { core } from "./core"

export function App() {
  const [status, setStatus] = createSignal("Connecting to the core…")
  const [roundTrip, setRoundTrip] = createSignal<number>()
  let sentAt = 0

  onCleanup(
    core.listen((message) => {
      if (message.type === "hello") setStatus(`Core ${message.core} on Bun ${message.bun}`)
      if (message.type === "pong") setRoundTrip(Math.round(performance.now() - sentAt))
    }),
  )

  const ping = () => {
    sentAt = performance.now()
    core.send({ type: "ping", id: 1 })
  }

  return (
    <main class="flex h-full flex-col items-center justify-center gap-4 bg-background-base text-text-base">
      <p>{status()}</p>
      <Button onClick={ping}>Ping core</Button>
      <p>{roundTrip() === undefined ? "" : `${roundTrip()} ms`}</p>
    </main>
  )
}
