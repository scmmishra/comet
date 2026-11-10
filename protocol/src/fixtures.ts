import { DEFAULT_SETTINGS, type ClientMessage, type CoreMessage, type TabInfo } from "./index"

/**
 * Messages as the core and the app send them, for the types the native app reads or sends. The
 * typecheck holds them to the protocol, and the native app's tests decode and encode them, so a
 * change to one of these types fails whichever side it breaks.
 */

const TABS: TabInfo[] = [
  {
    id: "tab-1",
    title: "Fix the login form",
    project: "/Users/me/code/web",
    terminals: [{ id: "term-1", title: "zsh" }],
    files: [{ id: "file-1", path: "/Users/me/code/web/src/login.ts", line: 12 }],
    panelActive: "term-1",
    reviewScope: "git",
    panelOpen: true,
    model: "default",
    effort: "high",
    fast: true,
    permissionMode: "auto",
  },
  { id: "tab-2", title: "New session", project: "/Users/me/code/api", terminals: [], model: "opus", permissionMode: "default" },
]

export const CORE_MESSAGES = [
  { type: "settings", settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light" } } },
  { type: "tabs", tabs: TABS, active: "tab-2" },
  { type: "tabs", tabs: [] },
  { type: "recent", projects: ["/Users/me/code/api", "/Users/me/code/web"] },
  {
    type: "models",
    models: [
      { value: "default", label: "Default", description: "The recommended model", efforts: ["low", "high"], fast: false, autoMode: true },
      { value: "haiku", label: "Haiku", description: "Fastest", efforts: [], fast: false, autoMode: false },
    ],
  },
  { type: "tab.reopened", tab: TABS[1]!, index: 0 },
  { type: "tab.title", tabId: "tab-2", title: "Support conversation" },
  {
    type: "session.history",
    tabId: "tab-1",
    context: { percent: 12, tokens: 24_000, maxTokens: 200_000 },
    items: [
      { type: "user", id: "u1", text: "Fix the login form", at: 1_700_000_000_000, steered: true },
      { type: "thinking", id: "th1", text: "**Reading the form**", kind: "thought", label: "Reading the form" },
      { type: "tool", id: "t1", name: "Bash", summary: "npm test", result: { output: "1 failed", isError: true }, kind: "command", label: "Failed npm" },
      { type: "tool", id: "t2", name: "Edit", summary: "src/login.ts", file: "src/login.ts", edits: [{ before: "a", after: "b" }], kind: "edit", label: "Edited src/login.ts" },
      { type: "permission", id: "p1", requestId: "r1", tool: "Bash", kind: "command", detail: "rm -rf dist", reason: "It deletes files", allowSession: false },
      { type: "question", id: "q1", requestId: "r2", questions: [{ header: "Scope", question: "Which form?", options: [{ label: "Login" }], multiSelect: false }] },
      { type: "compaction", id: "c1", status: "done", preTokens: 180_000, postTokens: 32_000 },
      { type: "text", id: "x1", text: "Fixed it.", done: true, at: 1_700_000_060_000 },
      { type: "result", id: "r1", durationMs: 60_000, isError: false, stopped: true },
      { type: "error", id: "e1", message: "Rate limited" },
      { type: "changes", id: "ch1", files: [{ path: "src/login.ts", status: "modified", additions: 3, deletions: 1 }] },
      { type: "user", id: "u2", text: "A background task finished", selfStarted: true },
    ],
  },
  {
    type: "session.rows",
    tabId: "tab-1",
    rows: [
      { type: "item", id: "u1" },
      { type: "fold", id: "fold:u1", rows: [{ type: "group", id: "group:th1", steps: ["th1", "t1", "t2"], live: false, summary: "Ran a command and changed a file" }], durationMs: 60_000, stopped: true },
      { type: "working", id: "working:u2", since: 1_700_000_100_000 },
    ],
  },
  { type: "session.event", tabId: "tab-1", event: { kind: "item", item: { type: "text", id: "x2", text: "", done: false } } },
  { type: "session.event", tabId: "tab-1", event: { kind: "text.delta", id: "x2", delta: "Hel" } },
  { type: "session.event", tabId: "tab-1", event: { kind: "status", busy: true } },
  { type: "session.event", tabId: "tab-1", event: { kind: "context", reading: { percent: 20, tokens: 40_000, maxTokens: 200_000 } } },
  { type: "error", message: "The folder does not exist." },
] satisfies CoreMessage[]

/** In the order the native tests build them. */
export const CLIENT_MESSAGES = [
  { type: "models.get" },
  { type: "tab.reopen" },
  { type: "tabs.save", tabs: TABS, active: "tab-2" },
  { type: "session.send", tabId: "tab-1", text: "Add a test", followUp: "queue" },
  { type: "session.send", tabId: "tab-1", text: "Hi" },
  { type: "session.interrupt", tabId: "tab-1" },
  { type: "permission.answer", tabId: "tab-1", requestId: "r1", answer: "allow-session" },
] satisfies ClientMessage[]
