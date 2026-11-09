import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron"

const TAB_SHORTCUTS = 9

function command(name: string) {
  BrowserWindow.getFocusedWindow()?.webContents.send("desk:command", name)
}

export interface MenuActions {
  /** Picks a folder and opens it in the window. */
  readonly openFolder: () => void
}

/**
 * The app menu. Tab shortcuts live here because macOS gives menu accelerators the key first:
 * the default menu's ⌘W would close the window before the page could close a tab.
 */
export function installMenu(actions: MenuActions) {
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => command("tab.new") },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: actions.openFolder },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => command("tab.close") },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...Array.from({ length: TAB_SHORTCUTS }, (_, index): MenuItemConstructorOptions => ({
          label: `Tab ${index + 1}`,
          accelerator: `CmdOrCtrl+${index + 1}`,
          click: () => command(`tab.select:${index}`),
        })),
        { type: "separator" },
        { label: "Toggle Space Card", accelerator: "CmdOrCtrl+\\", click: () => command("space.toggle") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
