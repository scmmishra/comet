import { basename } from "node:path"
import { git } from "./git"

/** How long a project's file list is reused. A search per keystroke then lists the files once. */
const LIST_TTL_MS = 5_000
/** Enough results to pick from, in the @ list or the file search. */
const MAX_RESULTS = 50

const lists = new Map<string, { at: number; files: Promise<string[]> }>()

/**
 * The project's files, relative to its folder: what Git tracks and what it would add, so ignored
 * folders such as node_modules stay out. A folder that is not a Git repo has none.
 */
export function projectFiles(dir: string): Promise<string[]> {
  const cached = lists.get(dir)
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.files
  const files = git(dir, ["ls-files", "--cached", "--others", "--exclude-standard"])
    .then((listed) => listed.split("\n").filter(Boolean))
    .catch(() => [])
  lists.set(dir, { at: Date.now(), files })
  return files
}

/**
 * Files whose path matches `query`, best first: the file name equal to it, then starting with it, then
 * holding it, then the path holding it, then its letters in order. Shorter paths win a tie. An empty
 * query lists the shallowest files.
 */
export async function searchFiles(dir: string, query: string): Promise<string[]> {
  const files = await projectFiles(dir)
  const wanted = query.trim().toLowerCase()
  return files
    .flatMap((path) => {
      const rank = matchRank(path.toLowerCase(), wanted)
      return rank === undefined ? [] : [{ path, rank }]
    })
    .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, MAX_RESULTS)
    .map((match) => match.path)
}

function matchRank(path: string, query: string): number | undefined {
  if (!query) return path.split("/").length
  const name = basename(path)
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  if (path.includes(query)) return 3
  let at = 0
  for (const letter of path) if (letter === query[at]) at++
  return at === query.length ? 4 : undefined
}
