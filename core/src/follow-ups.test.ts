import { followUpFor } from "@desk/protocol"
import { expect, test } from "bun:test"

test("a slash command sent while the agent works waits in the queue, and other messages follow the choice", () => {
  expect(followUpFor("/rename Contact Import Review", "steer")).toBe("queue")
  expect(followUpFor("  /compact", "steer")).toBe("queue")
  expect(followUpFor("Check the import too", "steer")).toBe("steer")
  expect(followUpFor("Check the import too", "queue")).toBe("queue")
})
