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

/** The core's environment setup, run the way main.ts runs it, reporting what the core then sees. */
const SCRIPT = `import { takeLoginEnvironment } from ${JSON.stringify(join(import.meta.dir, "login-environment"))}
import { spawn } from ${JSON.stringify(join(import.meta.dir, "environment"))}
import { claudeCodePath } from ${JSON.stringify(join(import.meta.dir, "agents/claude/executable"))}
const started = performance.now()
const { ready, refreshed } = takeLoginEnvironment(Number(process.argv[2]))
await ready
const readyMs = performance.now() - started
const claude = await claudeCodePath().catch(() => null)
await refreshed
const run = async (command: string[], env?: Record<string, string>) => {
  try {
    return (await new Response(spawn(command, { stdout: "pipe", env }).stdout).text()).trim().split("\\n")
  } catch {
    return null
  }
}
console.log(JSON.stringify({ readyMs, claude, path: process.env.PATH, gh: await run(["gh"]), extra: await run(["gh"], { DESK_EXTRA: "yes" }) }))
`

interface Report {
  readyMs: number
  claude: string | null
  path: string
  gh: string[] | null
  extra: string[] | null
}

/** A home with no profile yet, and a way to make folders of fake claude and gh. */
function makeHome() {
  const dir = tempFolder("login-environment")
  const home = join(dir, "home")
  mkdirSync(home)
  const tools = (name: string) => {
    const folder = join(dir, name)
    mkdirSync(folder, { recursive: true })
    for (const tool of ["claude", "gh"]) {
      writeFileSync(join(folder, tool), REPORTER)
      chmodSync(join(folder, tool), 0o755)
    }
    return folder
  }
  const profile = (file: ".zprofile" | ".zshrc", text: string) => writeFileSync(join(home, file), text)
  return { dir, home, tools, profile, cache: join(dir, "desk", "shell-environment.json") }
}

/**
 * Starts the core's environment setup in a fresh Bun, as Desk opened from the Dock starts it: launchd's
 * PATH and Claude Code's session markers. It must run in its own process: Bun copies the environment
 * at start, and the test runner's environment already holds the user's tools.
 */
async function startFromDock(home: ReturnType<typeof makeHome>, options: { shell?: string; timeoutMs?: number } = {}): Promise<Report & { ms: number }> {
  const script = join(home.dir, "start.ts")
  writeFileSync(script, SCRIPT)
  const started = performance.now()
  const child = Bun.spawn([process.execPath, script, String(options.timeoutMs ?? 5_000)], {
    cwd: home.dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOME: home.home,
      DESK_HOME: join(home.dir, "desk"),
      PATH: LAUNCHD_PATH,
      SHELL: options.shell ?? "/bin/zsh",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CONFIG_DIR: "/kept",
    },
  })
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(error)
  return { ...(JSON.parse(out) as Report), ms: performance.now() - started }
}

test("Desk opened from the Dock finds claude on the PATH .zprofile sets", async () => {
  const home = makeHome()
  const tools = home.tools("tools")
  home.profile(".zprofile", `export PATH="${tools}:$PATH"\n`)
  const { claude, path } = await startFromDock(home)
  expect(claude).toBe(join(tools, "claude"))
  // The folders the app was given stay, after the shell's own.
  expect(path.split(":").slice(0, 1)).toEqual([tools])
  expect(path.split(":")).toContain("/usr/sbin")
})

test("Desk finds claude on a PATH only .zshrc sets, though .zshrc prints and leaves a job running", async () => {
  const home = makeHome()
  const tools = home.tools("tools")
  home.profile(".zshrc", `echo "Welcome back"\n(sleep 5) &\nexport PATH="${tools}:$PATH"\n`)
  const { claude, ms } = await startFromDock(home)
  expect(claude).toBe(join(tools, "claude"))
  expect(ms).toBeLessThan(4_000)
})

test("a .zshrc that hangs costs the timeout, then the login shell's PATH is used", async () => {
  const home = makeHome()
  const tools = home.tools("tools")
  home.profile(".zprofile", `export PATH="${tools}:$PATH"\n`)
  home.profile(".zshrc", "sleep 30\n")
  const { claude, ms } = await startFromDock(home, { timeoutMs: 300 })
  expect(claude).toBe(join(tools, "claude"))
  expect(ms).toBeLessThan(4_000)
})

test("a later start takes the cached environment at once, then refreshes it from the shell", async () => {
  const home = makeHome()
  const before = home.tools("before")
  home.profile(".zprofile", `export PATH="${before}:$PATH"\n`)
  await startFromDock(home)
  expect(JSON.parse(readFileSync(home.cache, "utf8")).environment.PATH.split(":")[0]).toBe(before)

  const after = home.tools("after")
  home.profile(".zprofile", `export PATH="${after}:$PATH"\n`)
  home.profile(".zshrc", "sleep 1\n")
  const { readyMs, claude, path } = await startFromDock(home)
  expect(readyMs).toBeLessThan(500)
  expect(claude).toBe(join(before, "claude"))
  expect(path.split(":")[0]).toBe(after)
  expect(JSON.parse(readFileSync(home.cache, "utf8")).environment.PATH.split(":")[0]).toBe(after)
})

test("what the core starts runs with the shell's PATH and without Claude Code's session markers", async () => {
  const home = makeHome()
  const tools = home.tools("tools")
  home.profile(".zprofile", `export PATH="${tools}:$PATH"\n`)
  const { gh, extra } = await startFromDock(home)
  const [ran, path, claudeCode, configDir, extraVariable] = gh!
  expect(ran).toBe(join(tools, "gh"))
  expect(path!.split(":")).toContain(tools)
  expect(claudeCode).toBe("unset")
  expect(configDir).toBe("/kept")
  expect(extraVariable).toBe("unset")
  expect(extra![4]).toBe("yes")
})

test("a shell that cannot start leaves the core running on the PATH it was given", async () => {
  const home = makeHome()
  const { claude, path } = await startFromDock(home, { shell: join(home.dir, "missing-shell") })
  expect(claude).toBeNull()
  expect(path.split(":")).toContain("/usr/bin")
})
