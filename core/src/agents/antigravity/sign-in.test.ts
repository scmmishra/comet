import { expect, test } from "bun:test"
import { fakeAcpAgent, FAKE_OPTIONS } from "../acp/fake-agent"
import { signInWithGoogle } from "./sign-in"
import { BROWSER_COMMAND, signInLink } from "./sign-in-link"

const LINK = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A40123%2F"
const PRINTED = `Open the following link to authenticate the ACP server: ${LINK}`

test("reads Google's sign-in link back to this Mac, and refuses any other", () => {
  expect(signInLink(PRINTED)).toBe(LINK)
  expect(signInLink(`DESK_ANTIGRAVITY_SIGN_IN ${LINK}\r`)).toBe(LINK)
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

test("the browser helper prints the link it is given as a line Desk reads, and opens nothing", () => {
  // The agent splits BROWSER at colons, as a PATH, so a colon would cut the command.
  expect(BROWSER_COMMAND).not.toContain(":")
  const printed = Bun.spawnSync(["/bin/sh", "-c", BROWSER_COMMAND.replace("%s", LINK)], { stdout: "pipe" })
  expect(printed.exitCode).toBe(0)
  expect(signInLink(printed.stdout.toString())).toBe(LINK)
})

test("opens the link the agent prints once, and is done when a session opens", async () => {
  const opened: string[] = []
  const learned: unknown[] = []
  const agent = fakeAcpAgent({
    authenticate: async () => {
      agent.print(PRINTED)
      agent.print(PRINTED)
      await Bun.sleep(10)
      return {}
    },
  })
  await signInWithGoogle(agent.process, { clientInfo: { name: "zed", version: "0.0.0" }, cwd: "/tmp/sign-in", open: (link) => void opened.push(link), learn: (options, fresh) => void learned.push([options, fresh]) })
  expect(opened).toEqual([LINK])
  expect(agent.sent("authenticate")).toEqual([{ methodId: "oauth-personal" }])
  expect(agent.sent("session/new")).toEqual([{ cwd: "/tmp/sign-in", mcpServers: [] }])
  expect(learned).toEqual([[FAKE_OPTIONS, true]])
  expect(await agent.process.exited).toBe(1)
})

test("says so when the account has no plan, and gives up after the timeout", async () => {
  const options = { clientInfo: { name: "zed", version: "0.0.0" }, cwd: "/tmp", open: () => {}, learn: () => {} }
  const refused = fakeAcpAgent({ "session/new": () => Promise.reject({ code: -32603, message: "SUBSCRIPTION_REQUIRED: no plan" }) })
  await expect(signInWithGoogle(refused.process, options)).rejects.toThrow("This Google account has no plan that includes Antigravity.")
  const waiting = fakeAcpAgent({ authenticate: () => new Promise(() => {}) })
  await expect(signInWithGoogle(waiting.process, { ...options, timeoutMs: 20 })).rejects.toThrow("Google sign-in timed out. Start sign-in again.")
  expect(await waiting.process.exited).toBe(1)
})
