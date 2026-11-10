import { expect, test } from "bun:test"
import { dropIndex } from "./tab-drag"

test("places a dragged tab after every other tab whose centre the pointer has passed", () => {
  const centres = [100, 314, 528]
  expect(dropIndex(centres, 20)).toBe(0)
  expect(dropIndex(centres, 101)).toBe(1)
  expect(dropIndex(centres, 400)).toBe(2)
  expect(dropIndex(centres, 900)).toBe(3)
})
