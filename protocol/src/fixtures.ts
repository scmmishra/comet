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
  { type: "error", message: "The folder does not exist." },
] satisfies CoreMessage[]

/** In the order the native tests build them. */
export const CLIENT_MESSAGES = [{ type: "models.get" }, { type: "tab.reopen" }, { type: "tabs.save", tabs: TABS, active: "tab-2" }] satisfies ClientMessage[]
