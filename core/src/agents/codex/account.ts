import type { AgentAccount } from "@desk/protocol"
import type { CodexAccount } from "./protocol"

/** How Codex signs in without a ChatGPT plan, in the words Desk shows. */
const METHODS: Record<Exclude<CodexAccount["type"], "chatgpt">, string> = {
  apiKey: "an API key",
  amazonBedrock: "Amazon Bedrock",
  gcp: "Google Cloud",
}

/** The account as Desk shows it. Codex reports none when no one is signed in. */
export function codexAccount(account: CodexAccount | null): AgentAccount | undefined {
  if (!account) return undefined
  if (account.type !== "chatgpt") return { method: METHODS[account.type] ?? account.type }
  return {
    ...(account.email ? { email: account.email } : {}),
    plan: account.planType,
    ...(account.workspaceName ? { organization: account.workspaceName } : {}),
  }
}
