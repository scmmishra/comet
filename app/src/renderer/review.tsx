import type { FileChange } from "@desk/protocol"
import { FileDiff, getSingularPatch } from "@pierre/diffs"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { fileIconId, fileIconName, requestFileIcon } from "./file-icons"
import type { Tab } from "./store"

const STATUS_LETTER: Record<FileChange["status"], string> = { added: "A", modified: "M", deleted: "D", renamed: "R" }

/** Diff options as OpenCode sets them: unified, word-level changes, and no file header of Pierre's own. */
const DIFF_OPTIONS = {
  theme: "pierre-dark",
  preferredHighlighter: "highlights",
  diffStyle: "unified",
  diffIndicators: "bars",
  lineDiffType: "word-line",
  hunkSeparators: "line-info-basic",
  overflow: "wrap",
  disableFileHeader: true,
  // Pierre draws in a shadow root and sets its own background there, so the override goes inside it.
  // The diff sits on the panel itself, with no background of its own.
  unsafeCSS: ":host { --diffs-bg: var(--color-panel); }",
} as const

/** What this tab's thread changed since its first message, file by file. */
export function ReviewView(props: { tab: Tab }) {
  const [selected, setSelected] = createSignal(0)
  const files = () => props.tab.review ?? []
  const totals = () => files().reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 })
  const current = () => files()[Math.min(selected(), files().length - 1)]

  return (
    <Show
      when={files().length > 0}
      fallback={<div class="m-auto px-6 text-center text-fg-3">{props.tab.review ? "This thread has not changed any files." : "Loading changes…"}</div>}
    >
      <div class="flex items-center gap-2 px-4 pb-2 pt-0.5 text-fg-2">
        {files().length} {files().length === 1 ? "file" : "files"}
        <span class="ml-auto flex gap-2 font-mono tabular-nums">
          <span class="text-add">+{totals().additions}</span>
          <span class="text-del">−{totals().deletions}</span>
        </span>
      </div>
      <div class="grid gap-px px-2 pb-2">
        <For each={files()}>
          {(file, index) => {
            const icon = fileIconName(file.path)
            requestFileIcon(icon)
            return (
              <button
                class="flex min-w-0 items-center gap-2 rounded-md px-2 py-[5px] text-left"
                classList={{ "bg-raised text-fg": index() === selected(), "text-fg-2 hover:bg-hover": index() !== selected() }}
                onClick={() => setSelected(index())}
              >
                <span class="w-3 shrink-0 font-mono text-[11px]" classList={{ "text-add": file.status === "added", "text-del": file.status === "deleted", "text-[#ddb065]": file.status === "modified" || file.status === "renamed" }}>
                  {STATUS_LETTER[file.status]}
                </span>
                <svg class="size-[14px] shrink-0" aria-hidden="true">
                  <use href={`#${fileIconId(icon)}`} />
                </svg>
                <span class="min-w-0 flex-1 truncate font-mono text-[12px]">{file.path}</span>
                <span class="shrink-0 font-mono text-[12px] tabular-nums text-add">+{file.additions}</span>
                <span class="shrink-0 font-mono text-[12px] tabular-nums text-del">−{file.deletions}</span>
              </button>
            )
          }}
        </For>
      </div>
      <Show when={current()} keyed>
        {(file) => (
          <div class="min-h-0 flex-1 overflow-auto border-t border-outline">
            <Show when={file.patch} fallback={<div class="p-4 text-fg-3">Binary file. No diff to show.</div>}>
              <PatchDiff patch={file.patch} />
            </Show>
          </div>
        )}
      </Show>
    </Show>
  )
}

/** One file's patch, drawn by @pierre/diffs. */
function PatchDiff(props: { patch: string }) {
  let container!: HTMLDivElement
  const diff = new FileDiff(DIFF_OPTIONS)
  onMount(() => {
    createEffect(() => diff.render({ fileDiff: getSingularPatch(props.patch), forceRender: true, containerWrapper: container }))
  })
  onCleanup(() => diff.cleanUp())
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
