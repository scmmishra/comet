import { expect, test } from "bun:test"
import { until } from "../../test-support"
import { fakeAcpAgent, FAKE_OPTIONS } from "../acp/test-agent"
import { signInWithGoogle } from "./sign-in"
import { BROWSER_COMMAND, signInLink } from "./sign-in-link"

const LINK = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A40123%2F"
/** The line the browser helper prints on the agent's stderr. */
const PRINTED = `DESK_ANTIGRAVITY_SIGN_IN ${LINK}`
const CONNECT = { clientInfo: { name: "fake-client", version: "1.0.0" }, authMethod: "fake-auth" }

test("reads Google's sign-in link back to this Mac, and refuses any other", () => {
  expect(signInLink(PRINTED)).toBe(LINK)
  expect(signInLink(`${PRINTED}\r`)).toBe(LINK)
  const refused = [
    LINK.replace("accounts.google.com", "evil.example"),
    LINK.replace("127.0.0.1%3A40123", "example.com%3A40123"),
    LINK.replace("40123", "80"),
    LINK.replace("response_type=code", "response_type=token"),
    `${LINK}&state=again`,
    `${LINK}#fragment`,
    LINK.replace("state=abc", "state="),
  ]
  expect(refused.map((link) => signInLink(`DESK_ANTIGRAVITY_SIGN_IN ${link}`))).toEqual(refused.map(() => undefined))
  expect(signInLink("Starting the server")).toBeUndefined()
})

test("the browser helper prints the link it is given on stderr as a line Desk reads, and opens nothing", () => {
  // BROWSER may list several commands split at colons, so a colon would cut the command.
  expect(BROWSER_COMMAND).not.toContain(":")
  const printed = Bun.spawnSync(["/bin/sh", "-c", BROWSER_COMMAND.replace("%s", LINK)], { stdout: "pipe", stderr: "pipe" })
  expect(printed.exitCode).toBe(0)
  expect(printed.stdout.toString()).toBe("")
  expect(signInLink(printed.stderr.toString())).toBe(LINK)
})

test("opens the link the agent prints once, and is done when a session opens", async () => {
  const opened: string[] = []
  const learned: unknown[] = []
  const linkOpened = Promise.withResolvers<void>()
  const agent = fakeAcpAgent({
    // The agent answers once the user has signed in, after the link opened.
    authenticate: async () => {
      agent.printError(PRINTED)
      agent.printError(PRINTED)
      await linkOpened.promise
      return {}
    },
  })
  const open = (link: string) => {
    opened.push(link)
    linkOpened.resolve()
  }
  await signInWithGoogle(agent.process, { connect: CONNECT, cwd: "/tmp/sign-in", open, learn: (options, fresh) => void learned.push([options, fresh]), signal: new AbortController().signal })
  expect(opened).toEqual([LINK])
  expect(agent.sent("authenticate")).toEqual([{ methodId: "fake-auth" }])
  expect(agent.sent("session/new")).toEqual([{ cwd: "/tmp/sign-in", mcpServers: [] }])
  expect(learned).toEqual([[FAKE_OPTIONS, true]])
  expect(await agent.process.exited).toBe(1)
})

test("says so when the account has no plan, and gives up after the timeout", async () => {
  const options = { connect: CONNECT, cwd: "/tmp", open: () => {}, learn: () => {}, signal: new AbortController().signal }
  const refused = fakeAcpAgent({ "session/new": () => Promise.reject({ code: -32603, message: "SUBSCRIPTION_REQUIRED: no plan" }) })
  await expect(signInWithGoogle(refused.process, options)).rejects.toThrow("This Google account has no plan that includes Antigravity.")
  const waiting = fakeAcpAgent({ authenticate: () => new Promise(() => {}) })
  await expect(signInWithGoogle(waiting.process, { ...options, timeoutMs: 20 })).rejects.toThrow("Google sign-in timed out. Start sign-in again.")
  expect(await waiting.process.exited).toBe(1)
})

test("stops when the user stops it, and ends the agent's process", async () => {
  const stop = new AbortController()
  const opened: string[] = []
  const waiting = fakeAcpAgent({
    authenticate: () => {
      waiting.printError(PRINTED)
      return new Promise(() => {})
    },
  })
  const signingIn = signInWithGoogle(waiting.process, { connect: CONNECT, cwd: "/tmp", open: (link) => void opened.push(link), learn: () => {}, signal: stop.signal })
  await until(() => opened.length === 1)
  stop.abort()
  await expect(signingIn).rejects.toThrow("Cancelled.")
  expect(await waiting.process.exited).toBe(1)
})
