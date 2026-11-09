import { basename } from "node:path"
import type { Space } from "@desk/protocol"

/** Runs a command in `dir` and returns its trimmed stdout, or undefined when it fails. */
async function run(command: string[], dir: string): Promise<string | undefined> {
  try {
    const child = Bun.spawn(command, { cwd: dir, stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })
    const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? output.trim() : undefined
  } catch {
    return undefined
  }
}

/** Reads what the Space card shows. Each part fails on its own, so a missing `gh` only hides the PR. */
export async function readSpace(dir: string): Promise<Space | undefined> {
  const root = await run(["git", "rev-parse", "--show-toplevel"], dir)
  if (!root) return undefined
  const [branch, sha, numstat, untracked, counts, pr] = await Promise.all([
    run(["git", "branch", "--show-current"], root),
    run(["git", "rev-parse", "--short", "HEAD"], root),
    run(["git", "diff", "--numstat", "HEAD"], root),
    run(["git", "ls-files", "--others", "--exclude-standard"], root),
    run(["git", "rev-list", "--left-right", "--count", "@{upstream}...HEAD"], root),
    readPullRequest(root),
  ])
  return {
    name: basename(root),
    root,
    branch: branch || (sha ? `detached at ${sha}` : "no commits yet"),
    upstream: parseCounts(counts),
    changes: parseChanges(numstat ?? "", untracked ?? ""),
    pr,
  }
}

export function parseChanges(numstat: string, untracked: string): Space["changes"] {
  let additions = 0
  let deletions = 0
  let files = 0
  for (const line of numstat.split("\n")) {
    if (!line) continue
    const [added, removed] = line.split("\t")
    files++
    // Binary files show "-" for both counts.
    additions += Number(added) || 0
    deletions += Number(removed) || 0
  }
  files += untracked.split("\n").filter(Boolean).length
  return { files, additions, deletions }
}

function parseCounts(counts: string | undefined): Space["upstream"] {
  if (!counts) return undefined
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

async function readPullRequest(root: string): Promise<Space["pr"]> {
  const json = await run(["gh", "pr", "view", "--json", "number,title,url,state,isDraft,statusCheckRollup"], root)
  if (!json) return undefined
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
