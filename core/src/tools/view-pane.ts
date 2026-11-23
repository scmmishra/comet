import { basename, relative, resolve } from "node:path"
import { REVIEW_SCOPES, type FileChange, type ReviewScope } from "@comet/protocol"
import { openableFile } from "../files"
import type { CometTool, ToolGroup } from "./tool"

/** The scope `open_diff` shows when the agent names none: the changes as they are now, which a turn that runs has not finished yet. */
const DEFAULT_SCOPE: ReviewScope = "git"
/** How many changed files a refusal lists, so the agent can pick one. */
const LISTED_CHANGES = 20

/** What the tools are told about a session's tab. */
export interface ViewPaneHost {
  /** The folder the session's tab works in. */
  project(): string
  /** What changed in the tab's project over `scope`, as Review reads it. */
  changes(scope: ReviewScope): Promise<readonly FileChange[]>
  /** Shows a file in the tab's view pane. `path` is absolute. Throws when the session no longer runs the tab's thread. */
  showFile(path: string, line: number | undefined): void
  /** Shows Review in the tab's view pane, at the file `path` names as Review lists it. Throws as `showFile` does. */
  showReview(scope: ReviewScope, path: string | undefined): void
}

const INSTRUCTIONS = [
  "Comet shows a view pane beside this thread. Call `open_file` to show the user a file there, at a line, and `open_diff` to show them changes in Review.",
  "Use them when the user asks to see a file or a diff, or when the lines your answer is about are easier to read in place. Do not open every file you read. They do not take the user's focus.",
].join("\n")

const SCOPE_WORDS: Record<ReviewScope, string> = {
  git: "uncommitted changes, as they are now",
  branch: "changes since this branch left the default branch",
  thread: "changes this thread made, up to its last finished turn",
  turn: "changes of the last finished turn",
}

const lineOf = (input: Record<string, unknown>) => (typeof input.line === "number" && Number.isInteger(input.line) && input.line > 0 ? input.line : undefined)

export const OPEN_FILE: CometTool = {
  name: "open_file",
  description: "Opens a file in the view pane beside this thread, scrolled to `line` when given. A file already open there comes to the front.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The file's path, absolute or relative to the project's folder." },
      line: { type: "integer", minimum: 1, description: "The line to show, counted from 1." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  summary: (input) => `${basename(String(input.path ?? ""))}${lineOf(input) ? `:${lineOf(input)}` : ""}`,
  label: (summary, done) => `${done ? "Opened" : "Opening"} ${summary}`,
}

export const OPEN_DIFF: CometTool = {
  name: "open_diff",
  description: `Opens Review in the view pane beside this thread, on the changes over \`scope\`, scrolled to \`path\` when given. The scopes:\n${REVIEW_SCOPES.map((scope) => `- \`${scope}\`: ${SCOPE_WORDS[scope]}.`).join("\n")}`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "A changed file to scroll to, absolute or relative to the project's folder." },
      scope: { type: "string", enum: [...REVIEW_SCOPES], description: `The changes to show. Leave it out for \`${DEFAULT_SCOPE}\`.` },
    },
    additionalProperties: false,
  },
  summary: (input) => (typeof input.path === "string" && input.path ? basename(input.path) : ""),
  label: (summary, done) => (summary ? `${done ? "Opened the diff of" : "Opening the diff of"} ${summary}` : done ? "Opened Review" : "Opening Review"),
}

/** The tools that show a file or a diff in the view pane of a session's tab. */
export const viewPaneTools = (host: ViewPaneHost): ToolGroup => ({
  instructions: INSTRUCTIONS,
  tools: [OPEN_FILE, OPEN_DIFF],
  call: async (name, input) => {
    if (name === OPEN_FILE.name) return openFile(host, input)
    return openDiff(host, input)
  },
})

function openFile(host: ViewPaneHost, input: Record<string, unknown>) {
  const path = typeof input.path === "string" ? input.path.trim() : ""
  if (!path) throw new Error("`path` names the file to open. It cannot be empty.")
  const file = openableFile(host.project(), path)
  if (!file) throw new Error(`No file is at ${path}.`)
  host.showFile(file, lineOf(input))
  return { text: "Opened in the view pane." }
}

async function openDiff(host: ViewPaneHost, input: Record<string, unknown>) {
  const scope = input.scope === undefined ? DEFAULT_SCOPE : REVIEW_SCOPES.find((found) => found === input.scope)
  if (!scope) throw new Error(`\`scope\` is one of: ${REVIEW_SCOPES.join(", ")}.`)
  const changes = await host.changes(scope)
  if (!changes.length) throw new Error(`There are no ${SCOPE_WORDS[scope]}.`)
  const path = typeof input.path === "string" && input.path.trim() ? input.path.trim() : undefined
  if (!path) {
    host.showReview(scope, undefined)
    return { text: "Opened Review in the view pane." }
  }
  // Review lists a file by its path in the project. The agent may name it by its absolute path.
  const project = host.project()
  const wanted = relative(project, resolve(project, path))
  const change = changes.find((found) => found.path === wanted)
  if (!change) {
    const listed = changes.slice(0, LISTED_CHANGES).map((found) => found.path)
    throw new Error(`${path} is not among the ${SCOPE_WORDS[scope]}. Those are in: ${listed.join(", ")}${changes.length > listed.length ? ", and more" : ""}.`)
  }
  host.showReview(scope, change.path)
  return { text: "Opened Review in the view pane, at the file." }
}
