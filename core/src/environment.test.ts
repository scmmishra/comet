import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tempFolder } from "./test-support"

/** The PATH launchd gives an app opened from the Dock or Finder. It holds none of the user's tools. */
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

/** A program that prints the path it ran from and the environment it got. */
const REPORTER = `#!/bin/sh
printf '%s\\n' "$0" "$PATH" "\${CLAUDECODE-unset}" "\${CLAUDE_CONFIG_DIR-unset}" "\${DESK_EXTRA-unset}"
`

/**
 * Starts the core's environment setup in a fresh Bun, as Desk opened from the Dock starts it: launchd's
 * PATH, Claude Code's session markers, and a home whose login profile puts the user's tools on PATH.
 * This must run in its own process: Bun copies the environment at start, and the test runner's
 * environment already holds the user's tools.
 */
async function startFromDock() {
  const dir = tempFolder("environment")
  const home = join(dir, "home")
  const tools = join(dir, "tools")
  mkdirSync(home)
  mkdirSync(tools)
  for (const tool of ["claude", "gh"]) {
    writeFileSync(join(tools, tool), REPORTER)
    chmodSync(join(tools, tool), 0o755)
  }
  // zsh reads .zprofile and sh reads .profile, so either login shell finds the tools.
  for (const profile of [".zprofile", ".profile"]) writeFileSync(join(home, profile), `export PATH="${tools}:$PATH"\n`)

  const script = join(dir, "start.ts")
  writeFileSync(
    script,
    `import { spawn, takeLoginEnvironment } from ${JSON.stringify(join(import.meta.dir, "environment"))}
import { claudeCodePath } from ${JSON.stringify(join(import.meta.dir, "claude-code"))}
await takeLoginEnvironment()
const run = async (command: string[], env?: Record<string, string>) => (await new Response(spawn(command, { stdout: "pipe", env }).stdout).text()).trim().split("\\n")
console.log(JSON.stringify({ claude: await claudeCodePath(), gh: await run(["gh"]), extra: await run(["gh"], { DESK_EXTRA: "yes" }) }))
`,
  )
  const child = Bun.spawn([process.execPath, script], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { HOME: home, PATH: LAUNCHD_PATH, SHELL: "/bin/zsh", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CONFIG_DIR: "/kept" },
  })
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(error)
  return { tools, ...(JSON.parse(out) as { claude: string; gh: string[]; extra: string[] }) }
}

test("Desk opened from the Dock finds the claude on the login shell's PATH", async () => {
  const { tools, claude } = await startFromDock()
  expect(claude).toBe(join(tools, "claude"))
})

test("what the core starts runs with the login shell's PATH and without Claude Code's session markers", async () => {
  const { tools, gh, extra } = await startFromDock()
  const [ran, path, claudeCode, configDir, extraVariable] = gh
  expect(ran).toBe(join(tools, "gh"))
  expect(path!.split(":")).toContain(tools)
  expect(claudeCode).toBe("unset")
  expect(configDir).toBe("/kept")
  expect(extraVariable).toBe("unset")
  expect(extra[4]).toBe("yes")
})

/** Files that may call Bun's spawn and which directly. `test-support.ts` runs only in tests, under the terminal's environment. */
const ALLOWED = ["environment.ts", "test-support.ts"]

test("the core starts programs only through environment.ts", async () => {
  const offenders: string[] = []
  for await (const file of new Bun.Glob("**/*.ts").scan(import.meta.dir)) {
    if (file.endsWith(".test.ts") || ALLOWED.includes(file)) continue
    if (/Bun\.(spawn|spawnSync|which)\b/.test(readFileSync(join(import.meta.dir, file), "utf8"))) offenders.push(file)
  }
  expect(offenders).toEqual([])
})
