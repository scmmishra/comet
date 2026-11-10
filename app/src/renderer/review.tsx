import { DiffChanges } from "@opencode/ui/diff-changes"
import { IconButton } from "@opencode/ui/icon-button"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Select } from "@opencode/ui/select"
import { FileDiff, getSingularPatch } from "@pierre/diffs"
import { createEffect, createRoot, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { REVIEW_SCOPES, type FileChange, type ReviewScope, type TabInfo } from "@desk/protocol"
import { colorScheme } from "./appearance"
import { fileIcon } from "./file-icons"
import { CODE_THEMES } from "./highlight"
import { plural } from "./format"
import { Chevron, Icon } from "./icons"
import { openFile } from "./file-tabs"
import { reviewScope } from "./threads"
import { setReviewScope } from "./workspace"

/** Review's scopes, in OpenCode's words, and what each says when nothing changed. */
const SCOPES: Record<ReviewScope, { label: string; empty: string }> = {
  thread: { label: "Thread changes", empty: "This thread has not changed any files." },
  git: { label: "Git changes", empty: "There are no uncommitted changes." },
  branch: { label: "Branch changes", empty: "This branch has no changes." },
  turn: { label: "Last turn changes", empty: "The last turn did not change any files." },
}

type DiffStyle = "unified" | "split"
const DIFF_STYLE_KEY = "desk.diffStyle"

/** How diffs draw, in every tab. A per-window preference, so it lives in the page's storage. */
const [diffStyle, setDiffStyle] = createRoot(() => {
  const [style, setStyle] = createSignal<DiffStyle>(readDiffStyle())
  return [style, (next: DiffStyle) => {
    setStyle(next)
    try {
      localStorage.setItem(DIFF_STYLE_KEY, next)
    } catch {
      // Storage can be unavailable. The choice then lasts until the page reloads.
    }
  }] as const
})

function readDiffStyle(): DiffStyle {
  try {
    return localStorage.getItem(DIFF_STYLE_KEY) === "split" ? "split" : "unified"
  } catch {
    return "unified"
  }
}

/** Diff options as OpenCode sets them: word-level changes, and no file header of Pierre's own. */
const DIFF_OPTIONS = {
  theme: CODE_THEMES,
  preferredHighlighter: "highlights",
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
 * What changed in the tab's project, after OpenCode's review. The header picks what to compare with,
 * and whether diffs are unified or split. Every file's diff shows in one scrolling list, under a header
 * that stays at the top while its diff scrolls by, and folds it.
 */
export function ReviewView(props: { tab: TabInfo; review: readonly FileChange[] | undefined }) {
  const scope = () => reviewScope(props.tab.id)
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
    <>
      {/* The controls stay put while the files scroll below them. */}
      <div class="flex shrink-0 items-center gap-2 px-3 pb-2 pt-0.5 text-fg-2">
        <Select
          options={[...REVIEW_SCOPES]}
          current={scope()}
          value={(option) => option}
          label={(option) => SCOPES[option].label}
          placement="bottom-start"
          gutter={6}
          onSelect={(option) => option && setReviewScope(props.tab.id, option)}
        />
        <Show when={files().length > 0}>
          <span class="text-fg-3">{plural(files().length, "file")}</span>
          <DiffChanges changes={totals()} />
        </Show>
        <SegmentedControl class="ml-auto" value={diffStyle()} onChange={(style) => style && setDiffStyle(style as DiffStyle)}>
          <SegmentedControlItem value="unified">Unified</SegmentedControlItem>
          <SegmentedControlItem value="split">Split</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <Show
      when={files().length > 0}
      fallback={<div class="m-auto px-6 text-center text-fg-3">{props.review ? SCOPES[scope()].empty : "Loading changes…"}</div>}
    >
      <For each={files()}>
        {(file) => {
          const slash = file.path.lastIndexOf("/")
          return (
            <section class="border-t border-outline">
              {/* The header folds the diff. Its open button sits beside the fold button, since a button cannot hold another. */}
              <div class="group/header sticky top-0 z-10 flex min-w-0 items-center bg-panel pr-2 hover:bg-hover">
              <button class="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4 text-left" aria-expanded={isOpen(file.path)} onClick={() => toggle(file.path)}>
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
              <Show when={file.status !== "deleted"}>
                <IconButton
                  variant="ghost-muted"
                  size="small"
                  class="ml-1 shrink-0 opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100"
                  aria-label={`Open ${file.path}`}
                  icon={<Icon name="arrow-up-right" />}
                  onClick={() => openFile(props.tab.project, file.path)}
                />
              </Show>
              </div>
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
      </div>
    </>
  )
}

/** One file's patch, drawn by @pierre/diffs. */
function PatchDiff(props: { patch: string }) {
  let container!: HTMLDivElement
  const diff = new FileDiff({ ...DIFF_OPTIONS, diffStyle: diffStyle(), themeType: colorScheme() })
  createEffect(on(colorScheme, (scheme) => diff.setThemeType(scheme), { defer: true }))
  onMount(() => {
    createEffect(() => {
      diff.setOptions({ ...DIFF_OPTIONS, diffStyle: diffStyle(), themeType: colorScheme() })
      diff.render({ fileDiff: getSingularPatch(props.patch), forceRender: true, containerWrapper: container })
    })
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
