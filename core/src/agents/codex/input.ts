import { IMAGE_TYPES, type ImageAttachment } from "@comet/protocol"
import type { UserInput } from "./protocol"

/** A message as Codex takes it: its text, then each image as a data URL. */
export function userInput(text: string, images: readonly ImageAttachment[]): object[] {
  return [...(text ? [{ type: "text", text, text_elements: [] }] : []), ...images.map((image) => ({ type: "image", url: `data:${image.mediaType};base64,${image.data}` }))]
}

/** An image Comet sent, read back from its data URL. Images Codex holds another way, such as by path, are not shown. */
export function imageAttachment(input: UserInput): ImageAttachment[] {
  if (input.type !== "image") return []
  const match = /^data:([^;]+);base64,(.*)$/s.exec(input.url)
  const mediaType = IMAGE_TYPES.find((type) => type === match?.[1])
  return match && mediaType ? [{ mediaType, data: match[2]! }] : []
}
