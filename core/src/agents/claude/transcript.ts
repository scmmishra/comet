import { getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk"
import { ThreadMapper } from "./thread"

/**
 * Where to cut a thread's transcript, for rewinding it or forking it from one of the user's messages.
 * A user message's item id is its uuid in the transcript, so the thread's ids lead into the transcript.
 */
export class Transcript {
  private constructor(
    /** The main conversation, in order. A subagent's messages are left out: they are not part of it. */
    private readonly messages: readonly SessionMessage[],
    /** The uuids of the messages the user sent, which start the turns. */
    private readonly prompts: ReadonlySet<string>,
  ) {}

  static async read(dir: string, sessionId: string): Promise<Transcript> {
    const messages = (await getSessionMessages(sessionId, { dir, includeSystemMessages: true })).filter((message) => !message.parent_tool_use_id)
    const prompts = new ThreadMapper(dir).history(messages).flatMap((item) => (item.type === "user" ? [item.id] : []))
    return new Transcript(messages, new Set(prompts))
  }

  /** The last message before `messageId`, where a rewound thread resumes. Undefined when the message opens the thread. */
  before(messageId: string): string | undefined {
    return this.messages[this.indexOf(messageId) - 1]?.uuid
  }

  /** The last message of the turn `messageId` starts, where a fork ends. Undefined when that turn is the last one. */
  turnEnd(messageId: string): string | undefined {
    const next = this.messages.findIndex((message, index) => index > this.indexOf(messageId) && this.prompts.has(message.uuid))
    return next < 0 ? undefined : this.messages[next - 1]!.uuid
  }

  private indexOf(messageId: string) {
    const index = this.messages.findIndex((message) => message.uuid === messageId)
    if (index < 0 || !this.prompts.has(messageId)) throw new Error("Comet could not find that message in the thread's transcript.")
    return index
  }
}
