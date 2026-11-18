import type { ImageAttachment } from "@comet/protocol"
import type { ContentBlock } from "./protocol"

/**
 * Whether a message can carry instructions. A slash command must stay at the start of the prompt for the
 * agent to run it, as T3 Code found.
 */
export const takesInstructions = (text: string) => !text.trimStart().startsWith("/")

/**
 * A message as an ACP prompt: its text, then each image. ACP has no field for a system prompt, so
 * `instructions` go before the text, wrapped as T3 Code wraps its own, so the model tells them from the
 * user's words.
 */
export function promptContent(text: string, images: readonly ImageAttachment[], instructions?: string): ContentBlock[] {
  const words = instructions ? `<comet_instructions>\n${instructions.trim()}\n</comet_instructions>\n\n<user_request>\n${text}\n</user_request>` : text
  return [...(words ? [{ type: "text" as const, text: words }] : []), ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mediaType }))]
}
