import { DEFAULT_SETTINGS, type CoreMessage } from "./index"

/**
 * Core messages as the core sends them, one of each type the native app reads. The typecheck holds
 * them to the protocol, and the native app's tests decode them, so a change to one of these types
 * fails whichever side it breaks.
 */
export const CORE_MESSAGES = [
  { type: "settings", settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light" } } },
  {
    type: "tabs",
    tabs: [
      { id: "tab-1", title: "Fix the login form", project: "/Users/me/code/web", terminals: [{ id: "term-1", title: "zsh" }], model: "default", permissionMode: "auto", panelOpen: true },
      { id: "tab-2", title: "New session", project: "/Users/me/code/api", terminals: [], model: "opus", permissionMode: "default" },
    ],
    active: "tab-2",
  },
  { type: "tabs", tabs: [] },
  { type: "error", message: "The folder does not exist." },
] satisfies CoreMessage[]
