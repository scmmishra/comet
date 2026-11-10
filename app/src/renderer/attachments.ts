import { IMAGE_TYPES, MAX_IMAGE_BYTES, type ImageAttachment } from "@desk/protocol"
import { showToast } from "@opencode/ui/toast"

/** The image files among `files`, read for Claude. A file Claude cannot read is reported and left out. */
export async function readImages(files: Iterable<File>): Promise<ImageAttachment[]> {
  const images: ImageAttachment[] = []
  for (const file of files) {
    const mediaType = IMAGE_TYPES.find((type) => type === file.type)
    if (!mediaType) {
      showToast({ variant: "error", description: `${file.name || "This file"} is not a PNG, JPEG, GIF or WebP image.` })
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast({ variant: "error", description: `${file.name || "This image"} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` })
      continue
    }
    images.push({ mediaType, data: await base64(file) })
  }
  return images
}

/** An image's address for an img element. */
export const imageUrl = (image: ImageAttachment) => `data:${image.mediaType};base64,${image.data}`

function base64(file: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result).slice(String(reader.result).indexOf(",") + 1))
    reader.onerror = () => fail(reader.error)
    reader.readAsDataURL(file)
  })
}
