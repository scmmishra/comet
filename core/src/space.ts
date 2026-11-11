import { basename } from "node:path"
import type { Space } from "@desk/protocol"
import { git } from "./git"
import { spawn } from "./environment"

/** A part that fails gives undefined, so each part of the card fails on its own. */
const part = <T>(read: Promise<T>): Promise<T | undefined> => read.catch(() => undefined)
const gitOutput = (dir: string, args: string[]) => part(git(dir, args).then((output) => output.trim()))

/** The branch checked out in `dir`, or undefined outside a Git repo, before the first commit or on a detached HEAD. */
export const currentBranch = async (dir: string): Promise<string | undefined> => (await gitOutput(dir, ["branch", "--show-current"])) || undefined

/** Reads what the Space card shows, or null outside a Git repo. A missing `gh` only hides the PR. */
export async function readSpace(dir: string): Promise<Space | null> {
  const root = await gitOutput(dir, ["rev-parse", "--show-toplevel"])
  if (!root) return null
  const [branch, sha, numstat, untracked, counts, pr] = await Promise.all([
    gitOutput(root, ["branch", "--show-current"]),
    gitOutput(root, ["rev-parse", "--short", "HEAD"]),
    gitOutput(root, ["diff", "--numstat", "HEAD"]),
    gitOutput(root, ["ls-files", "--others", "--exclude-standard"]),
    gitOutput(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
    part(readPullRequest(root)),
  ])
  return {
    name: basename(root),
    root,
    branch: branch || (sha ? `detached at ${sha}` : "no commits yet"),
    ...(counts ? { upstream: parseCounts(counts) } : {}),
    changes: parseChanges(numstat ?? "", untracked ?? ""),
    ...(pr ? { pr } : {}),
  }
}

export function parseChanges(numstat: string, untracked: string): Space["changes"] {
  let additions = 0
  let deletions = 0
  let files = 0
  for (const line of numstat.split("\n").filter(Boolean)) {
    const counts = numstatLine(line)
    files++
    additions += counts.additions
    deletions += counts.deletions
  }
  files += untracked.split("\n").filter(Boolean).length
  return { files, additions, deletions }
}

function parseCounts(counts: string): NonNullable<Space["upstream"]> {
  const [behind, ahead] = counts.split(/\s+/).map(Number)
  return { ahead: ahead ?? 0, behind: behind ?? 0 }
}

interface GhPullRequest {
  number: number
  title: string
  url: string
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  statusCheckRollup?: Array<{ conclusion?: string; status?: string; state?: string }>
}

/** The branch's pull request, from `gh`. It throws when there is none or `gh` cannot say. */
async function readPullRequest(root: string): Promise<NonNullable<Space["pr"]>> {
  const child = spawn(["gh", "pr", "view", "--json", "number,title,url,state,isDraft,statusCheckRollup"], { cwd: root, stdout: "pipe", stderr: "ignore" })
  const [json, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error("No pull request")
  const pr = JSON.parse(json) as GhPullRequest
  const checks = { passed: 0, failed: 0, pending: 0 }
  for (const check of pr.statusCheckRollup ?? []) {
    // Check runs report a conclusion; commit statuses report a state.
    const outcome = (check.conclusion || check.state || "").toUpperCase()
    if (outcome === "SUCCESS" || outcome === "NEUTRAL" || outcome === "SKIPPED") checks.passed++
    else if (outcome === "FAILURE" || outcome === "ERROR" || outcome === "TIMED_OUT" || outcome === "CANCELLED" || outcome === "ACTION_REQUIRED") checks.failed++
    else checks.pending++
  }
  return { number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.isDraft, checks }
}

/** One line of `git diff --numstat`: its counts and the rest of the line. Binary files show "-" for both counts. */
function numstatLine(line: string): { additions: number; deletions: number; path: string } {
  const [added, removed, ...path] = line.split("\t")
  return { additions: Number(added) || 0, deletions: Number(removed) || 0, path: path.join("\t") }
}
