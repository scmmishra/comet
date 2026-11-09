import { expect, test } from "bun:test"
import { threadSummaries } from "./past-threads"

test("notes the tab that has a thread open", () => {
  const summaries = threadSummaries(
    [
      { sessionId: "a", summary: "Fix tabs", gitBranch: "main", lastModified: 2 },
      { sessionId: "b", summary: "Open in a tab", lastModified: 1 },
    ],
    new Map([["b", "tab-1"]]),
  )
  expect(summaries).toEqual([
    { id: "a", title: "Fix tabs", branch: "main", updatedAt: 2 },
    { id: "b", title: "Open in a tab", updatedAt: 1, tabId: "tab-1" },
  ])
})
