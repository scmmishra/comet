import { expect, test } from "bun:test"
import type { Skill } from "@comet/protocol"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { withFiles } from "./skill-files"

function file(path: string, text = "x") {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}

const skill = (name: string, group: string, extra: Partial<Skill> = {}): Skill => ({ name, description: "", ownProject: false, group, ...extra })

test("finds a skill's SKILL.md or a command's file in the project, the user's folder or the plugin's", () => {
  const base = mkdtempSync(join(tmpdir(), "comet-skill-files-"))
  const [project, root] = [join(base, "web"), join(base, "claude")]
  const review = file(join(project, ".claude", "skills", "review", "SKILL.md"))
  const pdf = file(join(root, "skills", "pdf", "SKILL.md"))
  const component = file(join(root, "commands", "frontend", "component.md"))
  const figma = file(join(base, "plugin-figma", "skills", "figma-use", "SKILL.md"))
  file(join(root, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "figma@official": [{ installPath: join(base, "plugin-figma") }] } }))
  const found = withFiles(project, [
    skill("help", "Claude Code", { builtin: true }),
    skill("review", "project", { ownProject: true }),
    skill("pdf", "User"),
    skill("frontend:component", "User"),
    skill("figma:figma-use", "Plugin: figma"),
    skill("synced", "claude.ai"),
  ], root)
  expect(found.map((one) => one.path)).toEqual([undefined, review, pdf, component, figma, undefined])
})
