import type { DeskCommand } from "../shared/commands"
import { pickModelByNumber } from "./model-picker"
import { usePalette } from "./palette"
import { SETTINGS_PAGES } from "./settings/pages"
import { closeSettings, closeTab, newTab, newTerminal, openFolder, openSettings, reopenTab, showTabAt, togglePanel, workspace, whenRestored } from "./workspace"

/**
 * Runs the app's commands, from the menu, from `desk <folder>` and from the palette. A command waits
 * until the saved tabs are back, so it never acts on an empty window. Call it inside the DialogProvider.
 */
export function useCommands() {
  const run = (command: DeskCommand) => whenRestored(() => handle(command))
  const togglePalette = usePalette(run)

  const handle = (command: DeskCommand) => {
    switch (command.id) {
      case "settings.open":
        return openSettings(SETTINGS_PAGES[0]!.id)
      case "tab.new":
        return newTab()
      case "terminal.new":
        return newTerminal()
      case "folder.open":
        return void openFolder()
      // Close what is in front: Settings when they show, else the tab.
      case "tab.close":
        return workspace.settingsPage === undefined ? closeTab(workspace.active) : closeSettings()
      case "tab.reopen":
        return reopenTab()
      case "panel.toggle":
        return togglePanelInstantly()
      case "palette.toggle":
        return togglePalette()
      case "threads.search":
        return togglePalette("threads")
      case "files.search":
        return togglePalette("files")
      case "tab.select":
        return pickModelByNumber(command.index) || showTabAt(command.index)
      case "project.open":
        return newTab("end", command.dir)
    }
  }
  return run
}

/**
 * Toggles the panel with no motion, for ⌘\\ and the menu. The new state is applied while transitions
 * are off, and reading layout forces that before they come back. Otherwise the next frame would see
 * the change with transitions on again, and slide anyway.
 */
function togglePanelInstantly() {
  const root = document.documentElement
  root.dataset.motion = "instant"
  togglePanel()
  void root.offsetHeight
  delete root.dataset.motion
}
