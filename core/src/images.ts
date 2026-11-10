import { IMAGE_TYPES, MAX_IMAGE_BYTES, type ImageAttachment } from "@desk/protocol"

/** The images a message carries, checked where they enter the core, so Claude never gets one it refuses. */
export function checkImages(images: readonly ImageAttachment[]): readonly ImageAttachment[] {
  for (const image of images) {
    if (!IMAGE_TYPES.includes(image.mediaType)) throw new Error(`Claude reads PNG, JPEG, GIF and WebP images, not ${image.mediaType}.`)
    // Four base64 characters hold three bytes.
    if ((image.data.length * 3) / 4 > MAX_IMAGE_BYTES) throw new Error(`An image can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
  }
  return images
}
