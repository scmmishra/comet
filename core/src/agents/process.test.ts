import { expect, test } from "bun:test"
import { explainEnd, lines, run } from "./process"
import { JsonRpc } from "./json-rpc"

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

/** Asks a program over JSON-RPC, as Desk does, and gives how the request failed. */
async function failureOf(command: string[]) {
  const rpc = new JsonRpc(explainEnd(run(command), "Codex"), { notification: () => {}, request: () => {}, closed: () => {} }, { versioned: false })
  return rpc.request("initialize").then(
    () => undefined,
    (error: Error) => error.message,
  )
}

test("a program that prints to stderr and exits says so in the error of a request it never answered", async () => {
  expect(await failureOf(["/bin/sh", "-c", "echo 'fake codex: config.toml is broken at line 7' >&2; exit 3"])).toBe("Codex exited with code 3.\n\nfake codex: config.toml is broken at line 7")
})

test("the error names a request made after the program had exited, not EPIPE", async () => {
  const program = run(["/bin/sh", "-c", "echo 'gone' >&2; exit 3"])
  await program.exited
  const rpc = new JsonRpc(explainEnd(program, "Codex"), { notification: () => {}, request: () => {}, closed: () => {} }, { versioned: false })
  await Bun.sleep(50)
  const error = await rpc.request("initialize").catch((error: Error) => error.message)
  expect(error).toBe("Codex exited with code 3.\n\ngone")
})

test("the error names the signal that ended the program, and keeps only the last lines of stderr", async () => {
  const noise = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\\n")
  expect(await failureOf(["/bin/sh", "-c", `printf '${noise}\\n' >&2; kill -9 $$`])).toBe("Codex was ended by SIGKILL.\n\nline 8\nline 9\nline 10\nline 11\nline 12")
  const long = await failureOf(["/bin/sh", "-c", "head -c 3000 /dev/zero | tr '\\0' x >&2; exit 1"])
  expect(long).toMatch(/^Codex exited with code 1\.\n\n…x{500}$/)
})

test("a program that exits with nothing on stderr gives only how it exited", async () => {
  expect(await failureOf(["/bin/sh", "-c", "exit 0"])).toBe("Codex exited with code 0.")
})
