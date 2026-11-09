import { expect, test } from "bun:test"
import { threadSummaries } from "./past-threads"

test("leaves out threads a tab has open", () => {
  const summaries = threadSummaries(
    [
      { sessionId: "a", summary: "Fix tabs", gitBranch: "main", lastModified: 2 },
      { sessionId: "b", summary: "Open in a tab", lastModified: 1 },
    ],
    new Set(["b"]),
  )
  expect(summaries).toEqual([{ id: "a", title: "Fix tabs", branch: "main", updatedAt: 2 }])
})
