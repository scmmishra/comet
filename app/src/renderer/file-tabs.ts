import type { FileTabInfo, FileView } from "@desk/protocol"
import { createEffect, createRoot, on } from "solid-js"
import { createStore } from "solid-js/store"
import { core } from "./core"
import { activeTab, openFileTab, shownPanelTab, shownTab } from "./workspace"

/**
 * Files shown as tabs in the view pane, after OpenCode. A file a reply names opens in the active tab's
 * panel. The core reads it, so a path relative to the project, absolute or from ~/ all work, and two
 * spellings of one file share a tab.
 */

/** The files the panel has read, by absolute path. A file stays until it is read again. */
const [views, setViews] = createStore<Record<string, FileView>>({})

export const fileView = (path: string): FileView | undefined => views[path]

/** Files asked to open, by project and path as asked, with the tab and line to open them at once read. */
const opening = new Map<string, { tabId: string; line?: number }>()
const key = (project: string, path: string) => `${project}\n${path}`

function readFile(project: string, path: string) {
  core.send({ type: "file.read", project, path })
}

core.listen((message) => {
  if (message.type !== "file") return
  setViews(message.file.path, message.file)
  const open = opening.get(key(message.project, message.path))
  if (!open) return
  opening.delete(key(message.project, message.path))
  openFileTab(open.tabId, message.file.path, open.line)
})

/**
 * Opens a file in a tab of the active tab's panel, at `line`. A file already open comes to the front.
 * A file that is not there opens nothing, and the core says why.
 */
export function openFile(project: string, path: string, line?: number) {
  const tabId = activeTab()?.id
  if (!tabId) return
  opening.set(key(project, path), { tabId, ...(line ? { line } : {}) })
  readFile(project, path)
}

/** Opens a file in the editor, as the panel's "Open in editor" asks. */
export function openInEditor(project: string, path: string, line?: number) {
  core.send({ type: "file.open", project, path, line })
}

/** The file tab a tab shows in its panel, if one does. */
const shownFile = (): { project: string; file: FileTabInfo } | undefined => {
  const tab = shownTab()
  const id = tab && shownPanelTab(tab)
  const file = tab?.files?.find((found) => found.id === id)
  return tab && file ? { project: tab.project, file } : undefined
}

// A file reads again when its tab comes to the front, and when a turn in the tab ends, so edits show.
createRoot(() => {
  const refresh = () => {
    const shown = shownFile()
    if (shown) readFile(shown.project, shown.file.path)
  }
  createEffect(on(() => shownFile()?.file.path, refresh))
  core.listen((message) => {
    if (message.type === "session.event" && message.event.kind === "item" && message.event.item.type === "result" && message.tabId === shownTab()?.id) refresh()
  })
})

// A hot-swapped copy of this module would start empty. In development, a change here reloads the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload())
