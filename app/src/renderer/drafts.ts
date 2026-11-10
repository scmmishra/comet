import type { ImageAttachment } from "@desk/protocol"
import { createStore } from "solid-js/store"
import { workspace } from "./workspace"

/** What a tab's composer holds before it is sent. */
export interface Draft {
  readonly text: string
  readonly images: readonly ImageAttachment[]
}

const EMPTY: Draft = { text: "", images: [] }
const STORAGE_KEY = "desk.drafts"
/** Typing writes the drafts to storage after this pause, not on every key. */
const SAVE_DELAY_MS = 400

/**
 * Each tab's unsent message, so switching tabs keeps it. The text is also kept in the page's storage, so
 * it outlives a restart. Images stay in memory only, since one can run to megabytes. A draft of a tab
 * that has closed is dropped the next time the drafts are saved.
 */
const [drafts, setDrafts] = createStore<Record<string, Draft>>(readSaved())

export const draftOf = (tabId: string): Draft => drafts[tabId] ?? EMPTY

export function setDraft(tabId: string, change: Partial<Draft>) {
  setDrafts(tabId, { ...draftOf(tabId), ...change })
  saveSoon()
}

let timer: ReturnType<typeof setTimeout> | undefined
function saveSoon() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const open = new Set(workspace.tabs.map((tab) => tab.id))
    const texts = Object.fromEntries(Object.entries(drafts).flatMap(([tabId, draft]) => (open.has(tabId) && draft.text ? [[tabId, draft.text]] : [])))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(texts))
    } catch {
      // Storage can be unavailable. Drafts then last until the page reloads.
    }
  }, SAVE_DELAY_MS)
}

function readSaved(): Record<string, Draft> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>
    return Object.fromEntries(Object.entries(saved).flatMap(([tabId, text]) => (typeof text === "string" ? [[tabId, { text, images: [] }]] : [])))
  } catch {
    return {}
  }
}
