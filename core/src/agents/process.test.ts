import { expect, test } from "bun:test"
import { lines } from "./process"

test("splits a byte stream into lines across chunks, and keeps a last line with no newline", async () => {
  const encode = (text: string) => new TextEncoder().encode(text)
  const stream = (async function* () {
    yield encode('{"a":')
    yield encode('1}\n{"b":2}\n{"c"')
    yield encode(":3}")
  })()
  const found: string[] = []
  for await (const line of lines(stream)) found.push(line)
  expect(found).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
})
