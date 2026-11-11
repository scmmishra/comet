import { expect, test } from "bun:test"
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk"
import { skillsFrom } from "./skills"

const command = (name: string, description: string, builtin = false) => ({ name, description, argumentHint: "", ...(builtin ? { builtin } : {}) }) as SlashCommand

test("moves the source out of the description, and groups Claude Code's own commands first, then skills in order", () => {
  const skills = skillsFrom([
    command("deploy", "Deploys the app."),
    command("figma:figma-use", "(figma) Load before every use_figma call."),
    command("pdf", "Use this skill for PDFs. (claude.ai sync)"),
    command("review", "Reviews a branch. (project)"),
    command("council", "Says council. (user)"),
    command("help", "Shows help.", true),
  ])
  expect(skills).toEqual([
    { name: "help", description: "Shows help.", builtin: true, ownProject: false, group: "Claude Code" },
    { name: "council", description: "Says council.", ownProject: false, group: "User" },
    { name: "pdf", description: "Use this skill for PDFs.", ownProject: false, group: "claude.ai" },
    { name: "figma:figma-use", description: "Load before every use_figma call.", ownProject: false, group: "Plugin: figma" },
    { name: "review", description: "Reviews a branch.", ownProject: true, group: "project" },
    { name: "deploy", description: "Deploys the app.", ownProject: false, group: "Other" },
  ])
})
