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
      { value: "default", label: "Default", description: "The recommended model", resolvedModel: "claude-opus-5-5", efforts: ["low", "high"], defaultEffort: "high", fast: true, autoMode: true },
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
      { type: "user", id: "u1", text: "Fix the login form", images: [{ mediaType: "image/png", data: "iVBORw==" }], at: 1_700_000_000_000, steered: true },
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
  { type: "session.event", tabId: "tab-1", event: { kind: "init", model: "claude-opus-5-5" } },
  {
    type: "session.event",
    tabId: "tab-1",
    event: {
      kind: "subagent",
      subagent: { id: "a1", description: "Find the tests", type: "Explore", status: "running", background: false, startedAt: 1_700_000_000_000, toolUses: 2, prompt: "Find them", items: [] },
    },
  },
  { type: "session.event", tabId: "tab-1", event: { kind: "context", reading: { percent: 20, tokens: 40_000, maxTokens: 200_000 } } },
  {
    type: "project",
    project: "/Users/me/code/web",
    part: "threads",
    value: [{ id: "s1", title: "Fix the login form", branch: "login", updatedAt: 1_700_000_000_000, tabId: "tab-1" }, { id: "s2", title: "Add tests", updatedAt: 1_699_000_000_000 }],
  },
  {
    type: "project",
    project: "/Users/me/code/web",
    part: "space",
    value: {
      name: "web",
      root: "/Users/me/code/web",
      branch: "main",
      upstream: { ahead: 2, behind: 0 },
      changes: { files: 2, additions: 10, deletions: 3 },
      pr: { number: 42, title: "Fix login", url: "https://github.com/me/web/pull/42", state: "OPEN", draft: false, checks: { passed: 3, failed: 1, pending: 0 } },
    },
  },
  { type: "project", project: "/Users/me/code/api", part: "space", value: null },
  {
    type: "project",
    project: "/Users/me/code/web",
    part: "plugins",
    value: { panels: [{ id: "support.inbox", title: "Inbox" }], setups: [], commands: [{ id: "support.search", title: "Search conversations", input: "Search for" }] },
  },
  {
    type: "project",
    project: "/Users/me/code/web",
    part: "skills",
    value: [
      { name: "compact", description: "Compact the context", builtin: true, ownProject: false, group: "Claude Code" },
      { name: "pdf", description: "Read PDFs", argumentHint: "<file>", ownProject: false, group: "User" },
    ],
  },
  {
    type: "review",
    tabId: "tab-1",
    scope: "thread",
    files: [{ path: "src/login.ts", status: "modified", additions: 1, deletions: 1, patch: "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1 +1 @@\n-a\n+b\n" }],
  },
  { type: "file", project: "/Users/me/code/web", path: "src/login.ts", file: { path: "/Users/me/code/web/src/login.ts", text: "export {}\n" } },
  { type: "terminal.output", id: "term-1", data: "\u001b[32mok\u001b[0m\r\n" },
  { type: "terminal.exit", id: "term-1", code: 0 },
  {
    type: "project",
    project: "/Users/me/code/web",
    part: "commands",
    value: [
      { id: "c1", name: "web", command: "bun run dev", group: "Dev", run: { state: "running" } },
      { id: "c2", name: "Tests", command: "bun test", run: { state: "failed", code: 1 } },
    ],
  },
  { type: "files.found", project: "/Users/me/code/web", query: "login", paths: ["src/login.ts", "test/login.test.ts"] },
  { type: "queue", tabId: "tab-1", messages: [{ id: "m1", text: "Then add a test" }], held: true },
  { type: "error", message: "The folder does not exist." },
  { type: "notice", message: "Copied the link." },
  {
    type: "plugin.ops",
    plugin: "support",
    reset: true,
    ops: [
      { op: "create", id: 1, type: "root" },
      { op: "create", id: 2, type: "button" },
      { op: "set", id: 2, key: "label", value: "Reply" },
      { op: "set", id: 2, key: "onClick", value: { handler: 3 } },
      { op: "insert", parent: 1, id: 2 },
      { op: "text", id: 4, text: "hi" },
      { op: "insert", parent: 1, id: 4, before: 2 },
      { op: "remove", parent: 1, id: 4 },
    ],
  },
  {
    type: "layout",
    tabId: "tab-1",
    layout: { sidebar: { id: "support.inbox", title: "Inbox", plugin: "support", root: 1 }, panels: [], cards: [{ id: "support.summary", title: "Summary", plugin: "support", root: 9 }] },
  },
  { type: "panel.show", tabId: "tab-1", id: "support.conversation?id=1001" },
  { type: "setups", setups: [{ project: "/Users/me/code/web", id: "support.triage", title: "Triage" }] },
  {
    type: "usage",
    usage: {
      windows: [
        { id: "five_hour", label: "Five hours", percent: 42, resetsAt: "2023-11-15T03:00:00.000Z" },
        { id: "seven_day", label: "Week", percent: 12 },
      ],
    },
  },
] satisfies CoreMessage[]

/** In the order the native tests build them. */
export const CLIENT_MESSAGES = [
  { type: "models.get" },
  { type: "usage.get" },
  { type: "tab.reopen" },
  { type: "tabs.save", tabs: TABS, active: "tab-2" },
  { type: "session.send", tabId: "tab-1", text: "Add a test", followUp: "queue" },
  { type: "session.send", tabId: "tab-1", text: "Hi", images: [{ mediaType: "image/png", data: "iVBORw==" }] },
  { type: "session.interrupt", tabId: "tab-1" },
  { type: "permission.answer", tabId: "tab-1", requestId: "r1", answer: "allow-session" },
  { type: "question.answer", tabId: "tab-1", requestId: "r2", answers: { "Which form?": "Login" } },
  { type: "question.answer", tabId: "tab-1", requestId: "r2" },
  { type: "queue.send", tabId: "tab-1", id: "m1" },
  { type: "queue.remove", tabId: "tab-1", id: "m1" },
  { type: "queue.resume", tabId: "tab-1" },
  { type: "project.get", project: "/Users/me/code/web", part: "threads" },
  { type: "thread.resume", tabId: "tab-2", threadId: "s1" },
  {
    type: "commands.save",
    project: "/Users/me/code/web",
    name: "Dev",
    processes: [
      { id: "c1", name: "web", command: "bun run dev" },
      { name: "worker", command: "bun run worker" },
    ],
    replacing: ["c1"],
  },
  { type: "commands.remove", project: "/Users/me/code/web", ids: ["c1"] },
  { type: "commands.run", project: "/Users/me/code/web", ids: ["c1"] },
  { type: "commands.stop", project: "/Users/me/code/web", ids: ["c1"] },
  { type: "files.search", project: "/Users/me/code/web", query: "login" },
  { type: "thread.clear", tabId: "tab-1" },
  { type: "layout.get", tabId: "tab-1" },
  { type: "panel.open", tabId: "tab-1", panel: "support.inbox" },
  { type: "panel.close", tabId: "tab-1", id: "support.conversation?id=1001" },
  { type: "setup.open", tabId: "tab-1", setup: "support.triage" },
  { type: "setups.get", project: "/Users/me/code/web" },
  { type: "plugin.command", tabId: "tab-1", command: "support.search", input: "refund" },
  { type: "plugin.event", plugin: "support", handler: 3, args: ["hi"] },
  { type: "terminal.open", id: "term-1", cols: 80, rows: 24 },
  { type: "terminal.input", id: "term-1", data: "ls\r" },
  { type: "terminal.resize", id: "term-1", cols: 100, rows: 30 },
  { type: "review.get", tabId: "tab-1", scope: "git" },
  { type: "file.read", project: "/Users/me/code/web", path: "src/login.ts" },
  { type: "file.open", project: "/Users/me/code/web", path: "src/login.ts", line: 12 },
] satisfies ClientMessage[]
