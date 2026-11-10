import { createRoot, createSignal } from "solid-js"

/** The time, in milliseconds since the epoch, updated each second. Live timers read it, so they tick together. */
export const now = createRoot(() => {
  const [time, setTime] = createSignal(Date.now())
  setInterval(() => setTime(Date.now()), 1000)
  return time
})
