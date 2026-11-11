import { expect, test } from "bun:test"
import { CANCELLED, permissionItem, permissionResponse, questionItem, questionResponse } from "./permissions"
import type { PermissionRequest } from "./protocol"
import { acpToolReader } from "./tools"

const request: PermissionRequest = {
  sessionId: "s1",
  toolCall: { toolCallId: "t1", title: "Run npm test", kind: "execute", rawInput: { command: "npm test" } },
  options: [
    { optionId: "once", name: "Allow", kind: "allow_once" },
    { optionId: "always", name: "Always allow", kind: "allow_always" },
    { optionId: "no", name: "Reject", kind: "reject_once" },
  ],
}

test("shows a command's request with the command, and offers the session when the agent does", () => {
  expect(permissionItem(request, acpToolReader)).toEqual({ type: "permission", id: "permission:t1", requestId: "t1", tool: "Run npm test", kind: "command", detail: "npm test", allowSession: true })
  const edit = permissionItem({ ...request, toolCall: { toolCallId: "t2", title: "Edit", kind: "move", locations: [{ path: "/repo/a.ts" }] }, options: request.options.slice(0, 1) }, acpToolReader)
  expect(edit).toMatchObject({ kind: "file-change", detail: "/repo/a.ts", allowSession: false })
})

test("answers with the option of each answer's kind", () => {
  const picked = (answer: Parameters<typeof permissionResponse>[1]) => permissionResponse(request, answer)
  expect(picked("allow")).toEqual({ outcome: { outcome: "selected", optionId: "once" } })
  expect(picked("allow-session")).toEqual({ outcome: { outcome: "selected", optionId: "always" } })
  expect(picked("decline")).toEqual({ outcome: { outcome: "selected", optionId: "no" } })
  expect(picked("cancel")).toEqual(CANCELLED)
  expect(permissionResponse({ ...request, options: request.options.slice(0, 1) }, "allow-session")).toEqual({ outcome: { outcome: "selected", optionId: "once" } })
})

test("asks a question with the request's options, and answers with the one chosen by its label", () => {
  const asked: PermissionRequest = {
    sessionId: "s1",
    toolCall: { toolCallId: "interaction_1", title: "Which database?" },
    options: [
      { optionId: "a", name: "Postgres", kind: "allow_once" },
      { optionId: "b", name: "SQLite", kind: "allow_once" },
    ],
  }
  expect(questionItem(asked)).toEqual({
    type: "question",
    id: "question:interaction_1",
    requestId: "interaction_1",
    questions: [{ header: "Question", question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }], multiSelect: false }],
  })
  expect(questionResponse(asked, { "Which database?": "SQLite" })).toEqual({ outcome: { outcome: "selected", optionId: "b" } })
  expect(questionResponse(asked, undefined)).toEqual(CANCELLED)
})
