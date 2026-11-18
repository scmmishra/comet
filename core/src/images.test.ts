import { MAX_IMAGE_BYTES } from "@comet/protocol"
import { expect, test } from "bun:test"
import { checkImages } from "./images"

test("takes the image types the agents read, up to its size limit", () => {
  expect(checkImages([{ mediaType: "image/png", data: "iVBOR" }])).toHaveLength(1)
  expect(() => checkImages([{ mediaType: "image/svg+xml" as never, data: "PHN2Zz4=" }])).toThrow("PNG, JPEG, GIF and WebP")
  expect(() => checkImages([{ mediaType: "image/jpeg", data: "A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) }])).toThrow("at most 5 MB")
})
