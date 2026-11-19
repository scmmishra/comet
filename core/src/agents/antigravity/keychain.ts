import { spawn } from "../../environment"

/** The program that reads the Mac's keychain. */
const SECURITY = "/usr/bin/security"
/**
 * The keychain item the `agy` CLI keeps its Google sign-in in, by service and account. It is the Mac's,
 * not a Gemini folder's, so every `agy` on this Mac shares one sign-in.
 */
const SIGN_IN_ITEM = ["-s", "gemini", "-a", "antigravity"]
/** What `security` exits with when it finds the item. */
const FOUND = 0

/**
 * Whether the `agy` CLI holds a Google sign-in. It asks only whether the item exists, never for the
 * token, so the keychain shows no prompt. The token may have expired: the CLI refreshes it as it starts.
 */
export async function hasSignIn(): Promise<boolean> {
  try {
    const found = spawn([SECURITY, "find-generic-password", ...SIGN_IN_ITEM], { stdout: "ignore", stderr: "ignore" })
    return (await found.exited) === FOUND
  } catch {
    return false
  }
}
