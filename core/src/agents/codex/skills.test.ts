import { expect, test } from "bun:test"
import { AppServer } from "./server"
import { readSkills, skillsFrom } from "./skills"
import { fakeAppServer } from "./test-app-server"

const skill = (name: string, scope: "user" | "repo" | "system" | "admin", extra: { enabled?: boolean; pluginId?: string } = {}) => ({ name, description: `${name} skill`, scope, enabled: extra.enabled ?? true, pluginId: extra.pluginId ?? null, path: `/skills/${name}/SKILL.md` })

test("groups the project's skills first, then the user's, then each plugin's, then Codex's own, and leaves out those turned off", () => {
  const skills = skillsFrom([skill("imagegen", "system"), skill("pdf:pdf", "user", { pluginId: "pdf@openai-primary-runtime" }), skill("review", "user"), skill("deploy", "repo"), skill("old", "user", { enabled: false })])
  expect(skills[0]!.path).toBe("/skills/deploy/SKILL.md")
  expect(skills.map((one) => [one.name, one.group, one.ownProject])).toEqual([
    ["deploy", "Project", true],
    ["review", "User", false],
    ["pdf:pdf", "Plugin: pdf", false],
    ["imagegen", "Codex", false],
  ])
})

test("reads the skills for the folder, and gives null when Codex cannot be asked", async () => {
  const codex = fakeAppServer()
  codex.answer("skills/list", { data: [{ cwd: "/code/web", skills: [skill("review", "user")], errors: [] }] })
  const server = new AppServer(codex.launch)
  expect((await readSkills(server, "/code/web"))!.map((one) => one.name)).toEqual(["review"])
  expect(codex.sent("skills/list")).toEqual([{ cwds: ["/code/web"] }])
  codex.answer("skills/list", () => {
    throw new Error("down")
  })
  expect(await readSkills(server, "/code/web")).toBeNull()
})
