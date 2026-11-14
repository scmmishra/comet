/** How the browser helper prints the link it was asked to open. */
const BROWSER_PREFIX = "DESK_ANTIGRAVITY_SIGN_IN "
/** The longest link Desk accepts, as in T3 Code. */
const MAX_LINK_LENGTH = 16_384
/** Google's sign-in page, which every link must open. */
const GOOGLE_SIGN_IN_PAGE = "https://accounts.google.com/o/oauth2/v2/auth"
/** Where Google returns the user: the agent's listener on this Mac, on a port a user may open. */
const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/$/
const LOWEST_USER_PORT = 1024
const HIGHEST_PORT = 65_535
const MAX_STATE_LENGTH = 512

/**
 * What the agent runs, as BROWSER, to open a link, with the link in place of `%s`. It prints the link
 * with a prefix on the agent's stderr, as T3 Code's helper does, and opens nothing. Desk reads the line,
 * opens the link after it checks it, and fails a session that needs a sign-in instead of opening a browser.
 * BROWSER may list several commands split at colons, so the command has none. It ignores a closed
 * stderr and exits 0, so the agent never falls back to opening a browser itself.
 */
export const BROWSER_COMMAND = `'/bin/sh' '-c' 'trap "" PIPE; echo "${BROWSER_PREFIX}$1" >&2; exit 0' 'sh' '%s'`

/**
 * The Google sign-in link a line of the browser helper announces. A line that announces no link, or a
 * link that is not Google's sign-in back to this Mac, gives undefined, after T3 Code.
 */
export function signInLink(line: string): string | undefined {
  const text = line.trimEnd()
  const link = text.startsWith(BROWSER_PREFIX) ? text.slice(BROWSER_PREFIX.length) : undefined
  return link !== undefined && isGoogleSignIn(link) ? link : undefined
}

function isGoogleSignIn(link: string): boolean {
  if (link.length > MAX_LINK_LENGTH || /\s/.test(link) || !URL.canParse(link)) return false
  const url = new URL(link)
  const params = url.searchParams
  const one = (key: string) => (params.getAll(key).length === 1 ? params.get(key)! : undefined)
  const state = one("state")
  const port = LOOPBACK_REDIRECT.exec(one("redirect_uri") ?? "")?.[1]
  return (
    `${url.origin}${url.pathname}` === GOOGLE_SIGN_IN_PAGE &&
    !url.username &&
    !url.password &&
    !url.hash &&
    one("response_type") === "code" &&
    !!state &&
    state.length <= MAX_STATE_LENGTH &&
    port !== undefined &&
    Number(port) >= LOWEST_USER_PORT &&
    Number(port) <= HIGHEST_PORT
  )
}
