import type { FileTabInfo, TabInfo } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { File } from "@pierre/diffs"
import { createEffect, on, onCleanup, onMount, Show } from "solid-js"
import { colorScheme } from "./appearance"
import { fileView, openInEditor } from "./file-tabs"
import { CODE_THEMES } from "./highlight"

/** How a file draws: Review's theme and font, with no header of Pierre's own, on the panel's background. */
const FILE_OPTIONS = {
  theme: CODE_THEMES,
  preferredHighlighter: "highlights",
  overflow: "wrap",
  disableFileHeader: true,
  // Pierre draws in a shadow root and sets its own background there, so the override goes inside it.
  unsafeCSS: ":host { --diffs-bg: var(--color-panel); }",
} as const

/** The file name a tab shows: the path's last part. */
export const fileTitle = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/**
 * A file open in the panel, after OpenCode: its path, a button to open it in the editor, then its text,
 * highlighted as Review highlights code. The line it was opened at is selected and scrolled into view.
 */
export function FileTabView(props: { tab: TabInfo; file: FileTabInfo }) {
  const view = () => fileView(props.file.path)
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center gap-2 px-3 pb-2 pt-0.5 text-[12px] text-fg-3">
        <span class="min-w-0 flex-1 truncate" title={props.file.path}>
          {props.file.path}
        </span>
        <Button size="small" variant="ghost" class="shrink-0" onClick={() => openInEditor(props.tab.project, props.file.path, props.file.line)}>
          Open in editor
        </Button>
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Show when={view()} fallback={<p class="m-auto text-fg-3">Reading the file…</p>}>
          {(file) => (
            <Show when={!file().binary} fallback={<p class="m-auto px-6 text-center text-fg-3">This is a binary file. Open it in the editor to see it.</p>}>
              <Show when={file().truncated}>
                <p class="px-3 pb-2 text-[12px] text-fg-3">The file is long, so only its first megabyte shows.</p>
              </Show>
              <Code path={props.file.path} text={file().text ?? ""} line={props.file.line} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}

/** A file's text, drawn by @pierre/diffs, with `line` selected and in view. */
function Code(props: { path: string; text: string; line?: number }) {
  let container!: HTMLDivElement
  const code = new File({ ...FILE_OPTIONS, themeType: colorScheme() })
  createEffect(on(colorScheme, (scheme) => code.setThemeType(scheme), { defer: true }))
  onMount(() => {
    createEffect(() => {
      code.render({ file: { name: props.path, contents: props.text, cacheKey: `${props.path}\n${props.text.length}` }, forceRender: true, containerWrapper: container })
      showLine(props.line)
    })
  })
  onCleanup(() => code.cleanUp())

  /** Selects a line and scrolls it to the middle of the panel. Pierre draws each line with its number in an open shadow root. */
  const showLine = (line: number | undefined) => {
    code.setSelectedLines(line ? { start: line, end: line } : null)
    if (!line) return
    const root = container.querySelector("*")?.shadowRoot
    root?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: "center" })
  }

  return (
    <div
      ref={container}
      style={{
        "--diffs-font-family": "var(--font-family-mono)",
        "--diffs-font-size": "12px",
        "--diffs-line-height": "20px",
      }}
    />
  )
}
