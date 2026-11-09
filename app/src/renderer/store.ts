import type { CoreMessage, Space, TabInfo, ThreadEvent } from "@desk/protocol"
import { createStore, produce } from "solid-js/store"
import { core } from "./core"

export type Item =
  | { readonly type: "user"; readonly id: string; readonly text: string }
  | { readonly type: "text"; readonly id: string; text: string; done: boolean }
  | { readonly type: "thinking"; readonly id: string }
  | { readonly type: "tool"; readonly id: string; readonly name: string; readonly input: Record<string, unknown>; result?: { readonly output: string; readonly isError: boolean } }
  | { readonly type: "permission"; readonly id: string; readonly requestId: string; readonly tool: string; readonly input: Record<string, unknown>; answer?: boolean }
  | { readonly type: "result"; readonly id: string; readonly durationMs: number; readonly isError: boolean }
  | { readonly type: "error"; readonly id: string; readonly message: string }

export interface Tab {
  readonly id: string
  title: string
  items: Item[]
  busy: boolean
  model?: string
}

const NEW_TAB_TITLE = "New session"
const TITLE_LENGTH = 40

const [state, setState] = createStore({
  tabs: [] as Tab[],
  active: "",
  space: undefined as Space | undefined,
  connected: false,
})
export { state }

export const activeTab = () => state.tabs.find((tab) => tab.id === state.active)

export function newTab() {
  const tab: Tab = { id: crypto.randomUUID(), title: NEW_TAB_TITLE, items: [], busy: false }
  setState(produce((draft) => {
    const index = draft.tabs.findIndex((found) => found.id === draft.active)
    draft.tabs.splice(index + 1, 0, tab)
    draft.active = tab.id
  }))
  saveTabs()
}

export function closeTab(id: string) {
  core.send({ type: "session.close", sessionId: id })
  setState(produce((draft) => {
    const index = draft.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    draft.tabs.splice(index, 1)
    if (draft.active === id) draft.active = draft.tabs[Math.max(0, index - 1)]?.id ?? ""
  }))
  if (state.tabs.length === 0) newTab()
  else saveTabs()
}

export function selectTab(id: string) {
  setState("active", id)
  saveTabs()
}

export function selectTabAt(index: number) {
  const tab = state.tabs[index]
  if (tab) selectTab(tab.id)
}

export function send(text: string) {
  const tab = activeTab()
  if (!tab) return
  if (tab.title === NEW_TAB_TITLE) {
    setState("tabs", (found) => found.id === tab.id, "title", titleFrom(text))
    saveTabs()
  }
  core.send({ type: "session.send", sessionId: tab.id, text })
}

export function interrupt() {
  const tab = activeTab()
  if (tab?.busy) core.send({ type: "session.interrupt", sessionId: tab.id })
}

export function answerPermission(id: string, allow: boolean) {
  const tab = activeTab()
  if (tab) core.send({ type: "permission.answer", sessionId: tab.id, id, allow })
}

export function openFile(path: string, line?: number) {
  core.send({ type: "file.open", path, line })
}

export function refreshSpace() {
  core.send({ type: "space.get" })
}

/** The core saves tab order and titles per space, so Desk reopens with the same tabs. */
function saveTabs() {
  core.send({ type: "tabs.save", tabs: state.tabs.map(({ id, title }) => ({ id, title })), active: state.active })
}

/** Puts back the tabs the core saved. Their threads follow as session events. */
function restoreTabs(tabs: readonly TabInfo[], active: string | undefined) {
  if (tabs.length === 0) return newTab()
  setState({
    tabs: tabs.map((tab) => ({ id: tab.id, title: tab.title, items: [], busy: false })),
    active: tabs.some((tab) => tab.id === active) ? active! : tabs[0]!.id,
  })
}

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0] ?? ""
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line || NEW_TAB_TITLE
}

core.listen((message: CoreMessage) => {
  if (message.type === "hello") {
    setState("connected", true)
    refreshSpace()
  } else if (message.type === "tabs") restoreTabs(message.tabs, message.active)
  else if (message.type === "space") setState("space", message.space)
  else if (message.type === "session.event") apply(message.sessionId, message.event)
})

function apply(sessionId: string, event: ThreadEvent) {
  setState("tabs", (tab) => tab.id === sessionId, produce((tab) => {
    const items = tab.items
    const find = (id: string) => items.find((item) => item.id === id)
    switch (event.kind) {
      case "user":
        items.push({ type: "user", id: event.id, text: event.text })
        break
      case "text": {
        const found = find(event.id)
        if (found?.type === "text") {
          found.text = event.text || found.text
          found.done = event.done
        } else items.push({ type: "text", id: event.id, text: event.text, done: event.done })
        break
      }
      case "text.delta": {
        const found = find(event.id)
        if (found?.type === "text") found.text += event.delta
        break
      }
      case "thinking":
        items.push({ type: "thinking", id: event.id })
        break
      case "tool":
        items.push({ type: "tool", id: event.id, name: event.name, input: event.input })
        break
      case "tool.result": {
        const found = find(event.id)
        if (found?.type === "tool") found.result = { output: event.output, isError: event.isError }
        break
      }
      case "permission":
        items.push({ type: "permission", id: `permission:${event.id}`, requestId: event.id, tool: event.tool, input: event.input })
        break
      case "permission.resolved": {
        const found = find(`permission:${event.id}`)
        if (found?.type === "permission") found.answer = event.allowed
        break
      }
      case "result":
        items.push({ type: "result", id: event.id, durationMs: event.durationMs, isError: event.isError })
        break
      case "error":
        items.push({ type: "error", id: event.id, message: event.message })
        break
      case "status":
        tab.busy = event.busy
        break
      case "init":
        tab.model = event.model
        break
    }
  }))
  // A finished turn may have changed files, so the Space card reads the repo again.
  if (event.kind === "result") refreshSpace()
}
