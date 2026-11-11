import { spawn } from "../../environment"
import type { AppServer } from "./server"

/** How long Desk waits for the user to finish signing in, in the browser. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

interface LoginCompleted {
  readonly loginId: string | null
  readonly success: boolean
  readonly error: string | null
}

/** Opens a link in the default browser. */
export const openInBrowser = (url: string) => void spawn(["open", url])

/**
 * Signs in with ChatGPT. Codex gives a link to open in the browser, and says when the sign-in there
 * has finished. It fails with Codex's reason, and after five minutes without an answer.
 */
export async function signIn(server: AppServer, open: (url: string) => void = openInBrowser): Promise<void> {
  let loginId: string | undefined
  let stop = () => {}
  const completed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The sign-in took too long. Try again."))
      if (loginId) void server.request("account/login/cancel", { loginId }).catch(() => undefined)
    }, SIGN_IN_TIMEOUT_MS)
    const unsubscribe = server.on<LoginCompleted>("account/login/completed", (done) => {
      if (done.loginId !== null && loginId !== undefined && done.loginId !== loginId) return
      stop()
      if (done.success) resolve()
      else reject(new Error(done.error ?? "Codex could not sign you in."))
    })
    stop = () => {
      clearTimeout(timer)
      unsubscribe()
    }
  })
  // The sign-in may fail before Desk waits on it, while Codex answers the start.
  completed.catch(() => undefined)
  try {
    const started = await server.request<{ type: string; loginId: string; authUrl: string }>("account/login/start", { type: "chatgpt" })
    loginId = started.loginId
    open(started.authUrl)
    await completed
  } finally {
    stop()
  }
}
