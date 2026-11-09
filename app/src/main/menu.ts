import { app, Menu, type MenuItemConstructorOptions } from "electron"
import { COMMANDS, TAB_SHORTCUTS, tabShortcut, type CommandId, type DeskCommand } from "../shared/commands"

/**
 * The app menu. Shortcuts live here because macOS gives menu accelerators the key first: the default
 * menu's ⌘W would close the window before the page could close a tab. Each item sends its command to the page.
 */
export function installMenu(send: (command: DeskCommand) => void) {
  const item = (id: CommandId): MenuItemConstructorOptions => ({ label: COMMANDS[id].title, accelerator: COMMANDS[id].accelerator, click: () => send({ id }) })
  const template: MenuItemConstructorOptions[] = [
    // The standard app menu, with Settings added where macOS apps put it.
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        item("settings.open"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "File", submenu: [item("tab.new"), item("terminal.new"), item("folder.open"), { type: "separator" }, item("tab.close")] },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...Array.from({ length: TAB_SHORTCUTS }, (_, index): MenuItemConstructorOptions => ({
          label: `Tab ${index + 1}`,
          accelerator: tabShortcut(index),
          click: () => send({ id: "tab.select", index }),
        })),
        { type: "separator" },
        item("panel.toggle"),
        item("palette.toggle"),
        item("threads.search"),
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
