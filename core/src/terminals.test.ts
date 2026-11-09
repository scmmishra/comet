import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { Terminals } from "./terminals"

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(20)
}

test("runs a shell on a PTY, takes input and replays output to a reopened view", async () => {
  let output = ""
  let exited = false
  const terminals = new Terminals(tmpdir(), {
    output: (_, data) => (output += data),
    exit: () => (exited = true),
  })
  terminals.open("t1", 80, 24)
  terminals.input("t1", "echo desk-$((40+2))\r")
  await until(() => output.includes("desk-42"))
  expect(output).toContain("desk-42")

  // A view drawn again receives what the terminal already showed.
  output = ""
  terminals.open("t1", 100, 30)
  expect(output).toContain("desk-42")

  terminals.input("t1", "exit\r")
  await until(() => exited)
  expect(exited).toBe(true)
  terminals.closeAll()
})
