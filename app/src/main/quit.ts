import { app } from "electron"

/** How long a first ⌘Q waits for the second. Long enough to read the notice and press again. */
const SECOND_PRESS_MS = 2000

let warnedAt = 0

/**
 * ⌘Q quits only when pressed twice, so a slip does not stop every running Claude turn. The first press
 * warns, and a second press soon after quits. `warn` shows the notice and says whether it could: with
 * no window to show it in, the first press quits.
 */
export function quitShortcut(warn: (message: string) => boolean) {
  if (Date.now() - warnedAt < SECOND_PRESS_MS) return app.quit()
  warnedAt = Date.now()
  if (!warn("Press ⌘Q again to quit Desk.")) app.quit()
}
