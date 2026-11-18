import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { Terminals } from "./terminals"
import { until } from "./test-support"

test("runs a shell on a PTY, takes input and replays output to a reopened view", async () => {
  let output = ""
  let exited = false
  const terminals = new Terminals({ output: (_, data) => (output += data), exit: () => (exited = true) })
  terminals.open("t1", tmpdir(), 80, 24)
  terminals.input("t1", "echo comet-$((40+2))\r")
  await until(() => output.includes("comet-42"))
  expect(output).toContain("comet-42")

  // A view drawn again receives what the terminal already showed.
  output = ""
  terminals.open("t1", tmpdir(), 100, 30)
  expect(output).toContain("comet-42")

  terminals.input("t1", "exit\r")
  await until(() => exited)
  expect(exited).toBe(true)
  terminals.closeAll()
})

test("retain closes the terminals it is not given", async () => {
  const exited: string[] = []
  const terminals = new Terminals({ output: () => {}, exit: (id) => exited.push(id) })
  terminals.open("kept", tmpdir(), 80, 24)
  terminals.open("dropped", tmpdir(), 80, 24)
  terminals.retain(new Set(["kept"]))
  await until(() => exited.includes("dropped"))
  expect(exited).toEqual(["dropped"])
  terminals.closeAll()
})
