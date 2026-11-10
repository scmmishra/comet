/**
 * The commands the app menu sends to the page, with their shortcuts. The menu, the page and the
 * command palette all read this list. macOS gives menu shortcuts the key before the page, so the
 * menu owns every shortcut here, even ones only the page acts on.
 */
export const COMMANDS = {
  "settings.open": { title: "Settings…", accelerator: "CmdOrCtrl+," },
  "tab.new": { title: "New Session", accelerator: "CmdOrCtrl+T" },
  "terminal.new": { title: "New Terminal", accelerator: "Ctrl+`" },
  "folder.open": { title: "Open Folder…", accelerator: "CmdOrCtrl+O" },
  "tab.close": { title: "Close Tab", accelerator: "CmdOrCtrl+W" },
  "tab.reopen": { title: "Reopen Closed Tab", accelerator: "CmdOrCtrl+Shift+T" },
  "panel.toggle": { title: "Toggle Panel", accelerator: "CmdOrCtrl+\\" },
  "palette.toggle": { title: "Command Palette…", accelerator: "CmdOrCtrl+K" },
  "threads.search": { title: "Search Threads…", accelerator: "CmdOrCtrl+Shift+O" },
} as const

export type CommandId = keyof typeof COMMANDS

/** ⌘1 to ⌘9 select a tab. */
export const TAB_SHORTCUTS = 9
export const tabShortcut = (index: number) => `CmdOrCtrl+${index + 1}`

/** A command from the menu, or from `desk <folder>`. */
export type DeskCommand = { readonly id: CommandId } | { readonly id: "tab.select"; readonly index: number } | { readonly id: "project.open"; readonly dir: string }

const KEY_LABELS: Record<string, string> = { CmdOrCtrl: "⌘", Cmd: "⌘", Ctrl: "⌃", Shift: "⇧", Alt: "⌥" }

/** A shortcut's keys as macOS draws them, such as ["⌘", "⇧", "O"]. */
export const keyLabels = (accelerator: string) => accelerator.split("+").map((key) => KEY_LABELS[key] ?? key)
