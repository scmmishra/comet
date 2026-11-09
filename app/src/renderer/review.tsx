import { DiffChanges } from "@opencode/ui/diff-changes"
import { FileDiff, getSingularPatch } from "@pierre/diffs"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import type { FileChange } from "@desk/protocol"
import { colorScheme } from "./appearance"
import { fileIcon } from "./file-icons"
import { CODE_THEMES } from "./highlight"
import { plural } from "./format"
import { Chevron } from "./icons"

/** Diff options as OpenCode sets them: unified, word-level changes, and no file header of Pierre's own. */
const DIFF_OPTIONS = {
  theme: CODE_THEMES,
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

/** Above this many files, the diffs start folded, so a large change opens as a list. */
const OPEN_FILE_LIMIT = 8

/**
 * What this tab's thread changed since its first message, after OpenCode's review: every file's diff
 * in one scrolling list, under a header that stays at the top while its diff scrolls by, and folds it.
 */
export function ReviewView(props: { review: readonly FileChange[] | undefined }) {
  const [toggled, setToggled] = createSignal(new Set<string>())
  const files = () => props.review ?? []
  const totals = () => files().reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 })
  // A file is open by default in a small change. Clicking its header flips that.
  const isOpen = (path: string) => (files().length <= OPEN_FILE_LIMIT) !== toggled().has(path)
  const toggle = (path: string) => {
    const next = new Set(toggled())
    if (!next.delete(path)) next.add(path)
    setToggled(next)
  }

  return (
    <Show
      when={files().length > 0}
      fallback={<div class="m-auto px-6 text-center text-fg-3">{props.review ? "This thread has not changed any files." : "Loading changes…"}</div>}
    >
      <div class="flex items-center gap-2 px-4 pb-2 pt-0.5 text-fg-2">
        {plural(files().length, "file")}
        <DiffChanges class="ml-auto" changes={totals()} />
      </div>
      <For each={files()}>
        {(file) => {
          const slash = file.path.lastIndexOf("/")
          return (
            <section class="border-t border-outline">
              <button
                class="sticky top-0 z-10 flex w-full min-w-0 items-center gap-2 bg-panel px-4 py-2 text-left hover:bg-hover"
                aria-expanded={isOpen(file.path)}
                onClick={() => toggle(file.path)}
              >
                <Chevron open={isOpen(file.path)} class="size-[13px] text-fg-3" />
                <svg class="size-[14px] shrink-0" aria-hidden="true">
                  <use href={`#${fileIcon(file.path)}`} />
                </svg>
                <span class="min-w-0 flex-1 truncate">
                  <span class="text-fg-3">{file.path.slice(0, slash + 1)}</span>
                  <span class="text-fg">{file.path.slice(slash + 1)}</span>
                  <Show when={file.status !== "modified"}>
                    <span class="ml-2 text-[12px] text-fg-3">{file.status}</span>
                  </Show>
                </span>
                <DiffChanges class="shrink-0" changes={file} />
              </button>
              <Show when={isOpen(file.path)}>
                <Show when={file.patch} fallback={<div class="px-4 pb-3 text-fg-3">Binary file. No diff to show.</div>}>
                  <PatchDiff patch={file.patch} />
                </Show>
              </Show>
            </section>
          )
        }}
      </For>
    </Show>
  )
}

/** One file's patch, drawn by @pierre/diffs. */
function PatchDiff(props: { patch: string }) {
  let container!: HTMLDivElement
  const diff = new FileDiff({ ...DIFF_OPTIONS, themeType: colorScheme() })
  createEffect(on(colorScheme, (scheme) => diff.setThemeType(scheme), { defer: true }))
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
