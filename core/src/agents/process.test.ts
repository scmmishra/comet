import { expect, test } from "bun:test"
import { lines, run } from "./process"

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

/** Resolves with the exit code, or with "running" if the program has not exited within `ms`. */
const exitWithin = (exited: Promise<number>, ms: number) => Promise.race([exited, Bun.sleep(ms).then(() => "running" as const)])

test("ends a program that exits on SIGTERM at once, and closing it twice is harmless", async () => {
  const program = run(["sleep", "600"])
  program.close()
  program.close()
  expect(await exitWithin(program.exited, 1000)).not.toBe("running")
})

test("kills a program that ignores SIGTERM after its grace period", async () => {
  // exec keeps one process. It inherits the ignored SIGTERM from the shell.
  const program = run(["/bin/sh", "-c", "trap '' TERM; exec sleep 600"])
  // The shell must have run the trap before the SIGTERM arrives.
  await Bun.sleep(200)
  program.close()
  expect(await exitWithin(program.exited, 1000)).toBe("running")
  expect(await exitWithin(program.exited, 3000)).not.toBe("running")
}, 10_000)

test("hands each stderr line to its listeners, and keeps the end of stderr", async () => {
  const program = run(["/bin/sh", "-c", "printf 'one\\ntw' >&2; sleep 0.1; printf 'o\\n' >&2"])
  const heard: string[] = []
  program.onStderrLine((line) => void heard.push(line))
  await program.exited
  await Bun.sleep(20)
  expect(heard).toEqual(["one", "two"])
  expect(program.stderr()).toBe("one\ntwo")
})
