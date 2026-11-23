import type { ThreadPullRequest, ThreadSummary } from "@comet/protocol"
import { spawn } from "./environment"
import { mainCheckout } from "./worktrees"

/** How long a branch's pull request, or its lack of one, stays known. The threads list is read often: on the start screen, the session menu and the palette. */
const FRESH_MS = 10 * 60_000
/** Branches asked about in one GraphQL query. */
const BRANCHES_PER_QUERY = 50
/** Pull requests read per branch, to find one from the repo itself among forks' pull requests from a branch of the same name. */
const PULL_REQUESTS_PER_BRANCH = 5

/** What is known of each branch, by repo and branch. A branch with no pull request is known too, so it is not asked about again. */
const known = new Map<string, { readonly pr?: ThreadPullRequest; readonly at: number }>()
const keyOf = (repo: string, branch: string) => `${repo}\0${branch}`

/** The threads, each with the pull request of its branch when it is known. `project` names the repo. */
export function withPullRequests(project: string, threads: readonly ThreadSummary[]): ThreadSummary[] {
  const repo = mainCheckout(project)
  return threads.map((thread) => {
    const pr = thread.branch && known.get(keyOf(repo, thread.branch))?.pr
    return pr ? { ...thread, pr } : thread
  })
}

/**
 * Asks GitHub, through `gh`, for the pull requests of the threads' branches that are not known or no longer
 * fresh. Resolves true when it learned a pull request. A failure, such as a repo not on GitHub or no `gh`,
 * learns nothing.
 */
export async function readPullRequests(project: string, threads: readonly ThreadSummary[]): Promise<boolean> {
  const repo = mainCheckout(project)
  const now = Date.now()
  // A detached HEAD has no branch to ask about.
  const stale = [...new Set(threads.flatMap((thread) => (thread.branch && thread.branch !== "HEAD" ? [thread.branch] : [])))].filter((branch) => {
    const found = known.get(keyOf(repo, branch))
    return !found || now - found.at > FRESH_MS
  })
  let learned = false
  for (let start = 0; start < stale.length; start += BRANCHES_PER_QUERY) {
    const branches = stale.slice(start, start + BRANCHES_PER_QUERY)
    const found = await queryBranches(repo, branches).catch(() => undefined)
    if (!found) return learned
    for (const branch of branches) {
      const pr = found.get(branch)
      if (pr && known.get(keyOf(repo, branch))?.pr?.url !== pr.url) learned = true
      known.set(keyOf(repo, branch), { ...(pr ? { pr } : {}), at: now })
    }
  }
  return learned
}

/** Forgets what is known, for tests. */
export function forgetPullRequests() {
  known.clear()
}

interface Connection {
  nodes: { number: number; title: string; url: string; isCrossRepository: boolean }[]
}

/**
 * One query for many branches, each under its own alias. The default branch gets no pull request: forks
 * open pull requests from theirs, such as `develop`, so it would match a stranger's. A pull request from
 * the repo itself wins over a fork's from a branch of the same name.
 */
async function queryBranches(repo: string, branches: string[]): Promise<Map<string, ThreadPullRequest>> {
  const fields = branches.map(
    (branch, index) => `b${index}: pullRequests(headRefName: ${JSON.stringify(branch)}, first: ${PULL_REQUESTS_PER_BRANCH}, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number title url isCrossRepository } }`,
  )
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { defaultBranchRef { name } ${fields.join(" ")} } }`
  // gh fills in {owner} and {repo} from the repo of the folder it runs in.
  const child = spawn(["gh", "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${query}`], { cwd: repo, stdout: "pipe", stderr: "ignore" })
  const [json, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error("gh could not read the pull requests")
  const repository = (JSON.parse(json) as { data: { repository: Record<string, Connection> & { defaultBranchRef: { name: string } | null } } }).data.repository
  const found = new Map<string, ThreadPullRequest>()
  branches.forEach((branch, index) => {
    if (branch === repository.defaultBranchRef?.name) return
    const nodes = repository[`b${index}`]?.nodes ?? []
    const pr = nodes.find((node) => !node.isCrossRepository) ?? nodes[0]
    if (pr) found.set(branch, { number: pr.number, title: pr.title, url: pr.url })
  })
  return found
}
