import { expect, test } from "bun:test"
import { skill } from "./skills"

test("moves the source Claude Code marks in a description out of it", () => {
  expect(skill({ name: "council", description: "Trigger this if the user says 'council'. (user)", argumentHint: "" })).toEqual({
    name: "council",
    description: "Trigger this if the user says 'council'.",
    source: "user",
  })
  expect(skill({ name: "pdf", description: "Use this skill for PDFs. (claude.ai sync)", argumentHint: "" })).toEqual({ name: "pdf", description: "Use this skill for PDFs.", source: "claude.ai sync" })
  expect(skill({ name: "figma:figma-use", description: "(figma) Load before every use_figma call.", argumentHint: "" })).toEqual({
    name: "figma:figma-use",
    description: "Load before every use_figma call.",
    source: "figma",
    plugin: true,
  })
  expect(skill({ name: "deploy", description: "Deploys the app.", argumentHint: "" })).toEqual({ name: "deploy", description: "Deploys the app.", source: "other" })
})
