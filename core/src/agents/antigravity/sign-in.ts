import { whenAborted } from "../abort"
import { AcpConnection } from "../acp/connection"
import { CANCELLED } from "../acp/permissions"
import type { ClientInfo, ConfigOption } from "../acp/protocol"
import type { Process } from "../json-rpc"
import { signInLink } from "./sign-in-link"

/** How long the user has to finish signing in, as in T3 Code. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** The method that signs in with a personal Google account, so its Google AI plan is used. */
export const GOOGLE_SIGN_IN = "oauth-personal"
/** What Google answers for an account whose plan does not include Antigravity. */
const SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED"

export interface SignInOptions {
  readonly clientInfo: ClientInfo
  /** The folder the sign-in's session opens in. */
  readonly cwd: string
  /** Opens the Google sign-in link in the browser. */
  readonly open: (link: string) => void
  /** The settings the signed-in session reported, such as the account's models. */
  readonly learn: (options: readonly ConfigOption[], opened: boolean) => void
  /** Aborts when the user stops the sign-in. */
  readonly signal: AbortSignal
  readonly timeoutMs?: number
}

/**
 * Signs the user in to Antigravity with their Google account, on a process started for it. The agent
 * announces Google's link once it authenticates, and Desk opens the link after it checks it. The sign-in
 * is done once the agent opens a session, which also reads the account's models. It stops when the user
 * stops it or after a timeout. The process ends either way.
 */
export async function signInWithGoogle(process: Process, options: SignInOptions) {
  let opened = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const signedIn = (async () => {
    const connection = await AcpConnection.open(
      process,
      {
        update: () => {},
        permission: async () => CANCELLED,
        closed: () => {},
        stray: (line) => {
          const link = signInLink(line)
          if (!link || opened) return
          opened = true
          options.open(link)
        },
      },
      { clientInfo: options.clientInfo, authMethod: GOOGLE_SIGN_IN },
    )
    const setup = await connection.newSession({ cwd: options.cwd, mcpServers: [] })
    options.learn(setup.configOptions ?? [], true)
  })()
  // After a timeout, closing the process fails the sign-in too, and nothing waits for it any more.
  signedIn.catch(() => undefined)
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Google sign-in timed out. Start sign-in again.")), options.timeoutMs ?? SIGN_IN_TIMEOUT_MS)
  })
  try {
    await Promise.race([signedIn, timedOut, whenAborted(options.signal)])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw message.includes(SUBSCRIPTION_REQUIRED) ? new Error("This Google account has no plan that includes Antigravity.") : error
  } finally {
    clearTimeout(timer)
    process.close()
  }
}
