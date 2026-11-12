import { expect, test } from "bun:test"
import { chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { branchBase, capture, captureWithin, changesSince, checkpointChanges, headTree, releaseCheckpoints, snapshot } from "./checkpoints"
import { gitRepo, tempFolder } from "./test-support"

test("reports what changed since a snapshot, new and deleted files included", async () => {
  const repo = gitRepo({ "a.txt": "one\ntwo\n", "old.txt": "gone\n" })
  const base = await snapshot(repo.dir)
  repo.write("a.txt", "one\nthree\n")
  repo.write("new.txt", "hello\n")
  rmSync(join(repo.dir, "old.txt"))

  const changes = await changesSince(repo.dir, async () => base)
  expect(changes.map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions }))).toEqual([
    { path: "a.txt", status: "modified", additions: 1, deletions: 1 },
    { path: "new.txt", status: "added", additions: 1, deletions: 0 },
    { path: "old.txt", status: "deleted", additions: 0, deletions: 1 },
  ])
  expect(changes[0]!.patch).toContain("+three")
})

test("reports a renamed file under its new path", async () => {
  const repo = gitRepo({ "src/old-name.ts": "export const a = 1\n".repeat(20) })
  const base = await snapshot(repo.dir)
  repo.git("mv", "src/old-name.ts", "src/new-name.ts")
  const [change] = await changesSince(repo.dir, async () => base)
  expect(change).toMatchObject({ path: "src/new-name.ts", status: "renamed" })
})

test("leaves the user's index alone", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  repo.write("staged.txt", "staged\n")
  repo.git("add", "staged.txt")
  const indexBefore = readFileSync(join(repo.dir, ".git", "index"))
  await snapshot(repo.dir)
  expect(readFileSync(join(repo.dir, ".git", "index")).equals(indexBefore)).toBe(true)
  expect(repo.git("diff", "--cached", "--name-only")).toBe("staged.txt")
})

test("has no changes when nothing moved", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  const base = await snapshot(repo.dir)
  expect(await changesSince(repo.dir, async () => base)).toEqual([])
})

test("compares uncommitted work with the last commit, and a branch's work with where it left main", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "feature")
  write("b.ts", "committed on the branch\n")
  git("add", ".")
  git("commit", "-q", "-m", "branch work")
  write("a.ts", "one\ntwo\n")

  const uncommitted = await changesSince(dir, headTree)
  expect(uncommitted.map((file) => file.path)).toEqual(["a.ts"])
  const branch = await changesSince(dir, branchBase)
  expect(branch.map((file) => file.path).sort()).toEqual(["a.ts", "b.ts"])
})

test("has no base outside a Git repo", async () => {
  expect(await headTree(tempFolder("plain"))).toBeUndefined()
})

/** Commits everything with a commit time an hour ago, as work done before a turn started. */
function commitEarlier(dir: string, message: string) {
  const env = { ...process.env, GIT_COMMITTER_DATE: `@${Math.floor(Date.now() / 1000) - 3600}` }
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir })
  Bun.spawnSync(["git", "commit", "-q", "-m", message], { cwd: dir, env })
}

const paths = (files: readonly { path: string }[]) => files.map((file) => file.path).sort()

test("leaves out the files a switch to a branch built on this one brings in", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "next")
  write("b.ts", "the next pull request\n")
  commitEarlier(dir, "next")
  git("checkout", "-q", "main")
  const from = (await capture(dir))!
  git("checkout", "-q", "next")
  expect(await checkpointChanges(dir, from, (await capture(dir))!)).toEqual([])
})

test("leaves out what a switch brings in, and keeps what the turn wrote, committed or not", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "other")
  write("theirs.ts", "someone else's\n")
  commitEarlier(dir, "theirs")
  git("checkout", "-q", "main")
  const from = (await capture(dir))!
  write("dirty.ts", "uncommitted\n")
  git("checkout", "-q", "other")
  write("mine.ts", "committed in the turn\n")
  git("add", "mine.ts")
  git("commit", "-q", "-m", "mine")
  expect(paths(await checkpointChanges(dir, from, (await capture(dir))!))).toEqual(["dirty.ts", "mine.ts"])
})

test("leaves out a branch's earlier work when the turn switches off it to a new branch", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "export")
  write("export.ts", "the export branch's own work\n")
  commitEarlier(dir, "export work")
  git("checkout", "-q", "main")
  write("pulled.ts", "a commit the pull brings in\n")
  commitEarlier(dir, "pulled")
  git("checkout", "-q", "export")
  const from = (await capture(dir))!
  // "Switch to main, pull, and start a new branch."
  git("checkout", "-q", "main")
  git("checkout", "-q", "-b", "new")
  expect(await checkpointChanges(dir, from, (await capture(dir))!)).toEqual([])
})

test("leaves out a branch merged in cleanly during the turn", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  git("checkout", "-q", "-b", "feature")
  write("feature.ts", "from the feature branch\n")
  commitEarlier(dir, "feature")
  git("checkout", "-q", "main")
  write("main.ts", "on main\n")
  commitEarlier(dir, "main work")
  const from = (await capture(dir))!
  git("merge", "-q", "--no-ff", "-m", "merge feature", "feature")
  expect(await checkpointChanges(dir, from, (await capture(dir))!)).toEqual([])
})

test("sees a same-size edit made in the second the user's index was written", async () => {
  // Each round commits, which writes the index, then at once makes an edit of the same size.
  for (let round = 0; round < 5; round++) {
    const { dir, write } = gitRepo({ "a.ts": "one\n" })
    const base = await snapshot(dir)
    write("a.ts", "two\n")
    expect(paths(await changesSince(dir, async () => base))).toEqual(["a.ts"])
  }
})

test("keeps every file while HEAD stays put", async () => {
  const { dir, write } = gitRepo({ "a.ts": "one\n" })
  const from = (await capture(dir))!
  write("a.ts", "changed\n")
  expect(paths(await checkpointChanges(dir, from, (await capture(dir))!))).toEqual(["a.ts"])
})

test("chains turns: the next turn starts where the last one ended, and counts edits made between them", async () => {
  const { dir, write } = gitRepo({ "a.ts": "one\n" })
  const start = (await capture(dir))!
  write("a.ts", "turn one\n")
  const first = (await capture(dir))!
  write("between.ts", "the user's edit between turns\n")
  write("b.ts", "turn two\n")
  const second = (await capture(dir))!
  expect(paths(await checkpointChanges(dir, start, first))).toEqual(["a.ts"])
  expect(paths(await checkpointChanges(dir, first, second))).toEqual(["b.ts", "between.ts"])
  expect(paths(await checkpointChanges(dir, start, second))).toEqual(["a.ts", "b.ts", "between.ts"])
})

test("keeps checkpoints from git gc under this Desk's refs, and lets go of those no thread names", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n" })
  const kept = (await capture(dir))!
  write("a.ts", "changed\n")
  const dropped = (await capture(dir))!
  git("update-ref", `refs/desk/dev/checkpoints/${dropped}`, dropped)
  expect(git("for-each-ref", "--format=%(refname)", "refs/desk/main/checkpoints/").split("\n").sort()).toEqual([`refs/desk/main/checkpoints/${dropped}`, `refs/desk/main/checkpoints/${kept}`].sort())

  await releaseCheckpoints([{ project: dir, commits: [kept] }])
  expect(git("for-each-ref", "--format=%(refname)", "refs/desk/")).toBe([`refs/desk/dev/checkpoints/${dropped}`, `refs/desk/main/checkpoints/${kept}`].join("\n"))
  // The user's branches and log are untouched.
  expect(git("branch", "--format=%(refname:short)")).toBe("main")
  expect(git("log", "--format=%s")).toBe("init")
})

test("reads paths Git would quote or split", async () => {
  const repo = gitRepo({ "x b/café.ts": "one\n" })
  const base = await snapshot(repo.dir)
  repo.write("x b/café.ts", "changed\n")
  const [change] = await changesSince(repo.dir, async () => base)
  expect(change).toMatchObject({ path: "x b/café.ts", additions: 1, deletions: 1 })
  expect(change!.patch).toContain("+changed")
})

test("reads the same patch whatever the user's diff settings", async () => {
  const repo = gitRepo({ "a.ts": "one\n\nthree\n" })
  for (const [key, value] of [["diff.noprefix", "true"], ["diff.mnemonicPrefix", "true"], ["diff.suppressBlankEmpty", "true"], ["diff.relative", "true"], ["color.diff", "always"]]) repo.git("config", key!, value!)
  const base = await snapshot(repo.dir)
  repo.write("a.ts", "one\n\n3\n")
  const [change] = await changesSince(repo.dir, async () => base)
  expect(change).toMatchObject({ path: "a.ts", additions: 1, deletions: 1 })
  // A blank context line stays a single space, so the patch still parses.
  expect(change!.patch).toContain("\n one\n \n-three\n+3")
})

test("lists a changed submodule even when the user asks diffs for its log", async () => {
  const inner = gitRepo({ "lib.ts": "one\n" })
  const repo = gitRepo({ "a.ts": "one\n" })
  repo.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.dir, "vendor")
  repo.git("commit", "-q", "-m", "add submodule")
  repo.git("config", "diff.submodule", "log")
  const base = await snapshot(repo.dir)
  inner.write("lib.ts", "two\n")
  inner.git("commit", "-qam", "two")
  Bun.spawnSync(["git", "pull", "-q"], { cwd: join(repo.dir, "vendor") })
  expect(paths(await changesSince(repo.dir, async () => base))).toEqual(["vendor"])
})

test("a project in a subfolder of a repo shows only its own files", async () => {
  const { dir, write } = gitRepo({ "app/a.ts": "one\n", "other/b.ts": "one\n" })
  const project = join(dir, "app")
  const from = (await capture(project))!
  write("app/a.ts", "changed\n")
  write("app/new.ts", "new\n")
  write("other/b.ts", "changed\n")
  write("other/new.ts", "new\n")
  expect(paths(await checkpointChanges(project, from, (await capture(project))!))).toEqual(["app/a.ts", "app/new.ts"])
  expect(paths(await changesSince(project, headTree))).toEqual(["app/a.ts", "app/new.ts"])
})

test("names a path that holds a tab, and gives quoted paths their patch and status", async () => {
  const repo = gitRepo({ 'q"uote.txt': "one\n", "back\\slash.txt": "gone\n" })
  const base = await snapshot(repo.dir)
  repo.write("a\tb.txt", "tab\n")
  repo.write('q"uote.txt', "two\n")
  rmSync(join(repo.dir, "back\\slash.txt"))
  const changes = await changesSince(repo.dir, async () => base)
  expect(changes.map(({ path, status }) => ({ path, status }))).toEqual([
    { path: "a\tb.txt", status: "added" },
    { path: "back\\slash.txt", status: "deleted" },
    { path: 'q"uote.txt', status: "modified" },
  ])
  expect(changes[0]!.patch).toContain("+tab")
  expect(changes[1]!.patch).toContain("-gone")
  expect(changes[2]!.patch).toContain("+two")
})

test("gives a file that changed type both halves of its patch, and the next file its own", async () => {
  const repo = gitRepo({ "z.txt": "one\n" })
  symlinkSync("target", join(repo.dir, "link"))
  repo.git("add", "link")
  repo.git("commit", "-qm", "link")
  const base = await snapshot(repo.dir)
  rmSync(join(repo.dir, "link"))
  repo.write("link", "now a file\n")
  repo.write("z.txt", "two\n")
  const [link, z] = await changesSince(repo.dir, async () => base)
  expect(link).toMatchObject({ path: "link", status: "modified" })
  expect(link!.patch).toContain("+now a file")
  expect(z).toMatchObject({ path: "z.txt", status: "modified" })
  expect(z!.patch).toContain("+two")
})

test("a file past the patch's byte limit keeps its status, with no patch", async () => {
  const repo = gitRepo({ "keep.txt": "one\n" })
  const base = await snapshot(repo.dir)
  repo.write("a-large.txt", ("y".repeat(99) + "\n").repeat(110_000))
  repo.write("z-new.txt", "new\n")
  const changes = await changesSince(repo.dir, async () => base)
  const added = changes.find((change) => change.path === "z-new.txt")
  expect(added).toMatchObject({ status: "added", additions: 1, patch: "" })
})

test("keeps the checkpoints of every project in a repo, whether a folder or a worktree", async () => {
  const { dir, git, write } = gitRepo({ "app/a.ts": "one\n", "web/b.ts": "one\n" })
  const worktree = join(tempFolder("worktree"), "tree")
  git("worktree", "add", "-q", "-b", "side", worktree)
  write("app/a.ts", "two\n")
  write("web/b.ts", "three\n")
  writeFileSync(join(worktree, "side.ts"), "side\n")
  const [app, web, side] = [(await capture(join(dir, "app")))!, (await capture(join(dir, "web")))!, (await capture(worktree))!]
  write("root.ts", "root\n")
  const gone = (await capture(dir))!
  await releaseCheckpoints([
    { project: join(dir, "app"), commits: [app] },
    { project: join(dir, "web"), commits: [web] },
    { project: worktree, commits: [side] },
    { project: tempFolder("not-a-repo"), commits: [] },
  ])
  const refs = git("for-each-ref", "--format=%(refname:lstrip=-1)", "refs/desk/").split("\n")
  expect(refs.sort()).toEqual([app, web, side].sort())
  expect(refs).not.toContain(gone)
})

test("sees edits to files the user marked assume-unchanged or skip-worktree, and keeps a sparse checkout's absent files", async () => {
  const repo = gitRepo({ "assumed.txt": "one\n", "skipped.txt": "one\n", "sparse.txt": "one\n" })
  repo.git("update-index", "--assume-unchanged", "assumed.txt")
  repo.git("update-index", "--skip-worktree", "skipped.txt", "sparse.txt")
  const base = await snapshot(repo.dir)
  repo.write("assumed.txt", "two\n")
  repo.write("skipped.txt", "two\n")
  rmSync(join(repo.dir, "sparse.txt"))
  expect(paths(await changesSince(repo.dir, async () => base))).toEqual(["assumed.txt", "skipped.txt"])
  // The user's own index keeps its bits.
  expect(repo.git("ls-files", "-v")).toBe("h assumed.txt\nS skipped.txt\nS sparse.txt")
})

test("keeps a file the turn committed by amending the last commit", async () => {
  const { dir, git, write } = gitRepo({ "a.ts": "one\n", "b.ts": "one\n" })
  const from = (await capture(dir))!
  write("a.ts", "two\n")
  git("commit", "-q", "--amend", "-am", "init, amended")
  expect(paths(await checkpointChanges(dir, from, (await capture(dir))!))).toEqual(["a.ts"])
})

test("a capture that takes longer than its bound gives none, and one within it gives its commit", async () => {
  const repo = gitRepo({ "a.txt": "one\n" })
  expect(await captureWithin(repo.dir, 0)).toBeUndefined()
  expect(await captureWithin(repo.dir, 60_000)).toMatch(/^[0-9a-f]{40}$/)
})

test("a capture outside a repo gives none, and one that Git fails in a repo says why", async () => {
  expect(await capture(tempFolder("plain"))).toBeUndefined()
  const repo = gitRepo({ "a.txt": "one\n" })
  writeFileSync(join(repo.dir, "b.txt"), "new\n")
  // Git cannot write the new file's object into a store it may not write to.
  const objects = join(repo.dir, ".git", "objects")
  chmodSync(objects, 0o555)
  try {
    await expect(capture(repo.dir)).rejects.toThrow()
    expect(await captureWithin(repo.dir, 60_000)).toBeUndefined()
  } finally {
    chmodSync(objects, 0o755)
  }
})

test("a capture in a repo with no commits has no parent, and one from a subfolder finds the repo's index", async () => {
  const dir = tempFolder("fresh")
  Bun.spawnSync(["git", "init", "-q", dir])
  writeFileSync(join(dir, "a.txt"), "one\n")
  const commit = (await capture(dir))!
  const show = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dir }).stdout.toString().trim()
  expect(show("log", "--format=%P", "-1", commit)).toBe("")
  expect(show("ls-tree", "--name-only", commit)).toBe("a.txt")

  const repo = gitRepo({ "app/a.ts": "one\n", "other.ts": "one\n" })
  repo.write("app/new.ts", "new\n")
  const inApp = (await capture(join(repo.dir, "app")))!
  expect(repo.git("log", "--format=%P", "-1", inApp)).toBe(repo.git("rev-parse", "HEAD"))
  expect(repo.git("ls-tree", "-r", "--name-only", inApp)).toBe("app/a.ts\napp/new.ts\nother.ts")
})
