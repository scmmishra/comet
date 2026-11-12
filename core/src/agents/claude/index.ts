import { homedir } from "node:os"
import type { Agent, AgentHost, Emit, SessionOptions } from "../agent"
import { claudeCodePath, NO_CLAUDE_CODE } from "./executable"
import { claudeMcp } from "./mcp"
import { claudeAccount, defaultEfforts, modelOptions } from "./models"
import { probe } from "./probe"
import { ClaudeSession } from "./session"
import { readSkills } from "./skills"
import { claudeThreads } from "./threads"
import { Usage } from "./usage"
import { claudeCodeVersion, updateClaudeCode } from "./version"

const SIGN_IN = "Run `claude` in a terminal to sign in."
const NO_ANSWER = "Claude Code did not answer. Run `claude` in a terminal to see why."

/**
 * Claude Code, run through the Claude Agent SDK. Desk runs the `claude` installed on this Mac, so it
 * uses the account, the plan and the settings Claude Code already has.
 */
export function claudeAgent(host: AgentHost): Agent {
  const usage = new Usage((reading) => host.publish({ usage: reading }))
  return {
    id: "claude",
    name: "Claude Code",
    features: ["steer", "rewind", "restore-files", "fork", "rename", "delete", "compact-idle"],
    threads: claudeThreads,
    commands: readSkills,
    mcp: claudeMcp,

    /** The models come as soon as the probe starts, then again with each model's default effort, which takes seconds to read. */
    async inspect() {
      if (!(await claudeCodePath().catch(() => undefined))) return host.publish({ state: "missing", problem: NO_CLAUDE_CODE })
      void claudeCodeVersion().then((version) => host.publish({ version }))
      // The account and the models read the same from any folder, so they are read from the home folder.
      const answered = await probe(homedir(), async (running) => {
        const { models, account } = await running.initializationResult()
        const found = claudeAccount(account)
        host.publish({ state: found ? "ready" : "signed-out", problem: found ? undefined : SIGN_IN, account: found, models: modelOptions(models) })
        host.publish({ models: modelOptions(models, await defaultEfforts(running, models)) })
        return true
      })
      if (!answered) host.publish({ state: "signed-out", problem: NO_ANSWER })
    },

    refreshUsage: () => usage.refresh(),

    open: (dir: string, emit: Emit, options: SessionOptions) => new ClaudeSession(dir, emit, { ...options, onRateLimit: (info) => usage.rateLimit(info), compactIdle: host.compactIdle }),

    async update() {
      await updateClaudeCode()
      host.publish({ version: await claudeCodeVersion() })
    },

    close() {},
  }
}
