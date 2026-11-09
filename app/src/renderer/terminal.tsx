import type { FitAddon, Ghostty, Terminal } from "ghostty-web"
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url"
import { createEffect, createRoot, on, onCleanup, onMount } from "solid-js"
import { appliedScheme, themeColor } from "./appearance"
import { core } from "./core"

type GhosttyModule = typeof import("ghostty-web")

/** One load of ghostty-web and its WASM, shared by every terminal. A failed load is tried again by the next one. */
let loading: Promise<{ mod: GhosttyModule; ghostty: Ghostty }> | undefined
function loadGhostty() {
  loading ??= import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load(wasmUrl) }))
    .catch((error) => {
      loading = undefined
      throw error
    })
  return loading
}

/** The terminal sits on the panel itself, with no background of its own, in the active theme's colours. */
const terminalTheme = () => ({
  background: themeColor("panel"),
  foreground: themeColor("fg"),
  cursor: themeColor("fg"),
  cursorAccent: themeColor("panel"),
  selectionBackground: themeColor("accent-soft"),
})

/**
 * ⌘ chords, after OpenCode. ghostty-web sends the plain letter to the shell for them, so ⌘K would type
 * "k". Returning true keeps a key from the shell. ⌘C and ⌘V stay native, so copy and paste work.
 */
function handleCommandKey(term: Terminal, event: KeyboardEvent): boolean {
  if (!event.metaKey || event.ctrlKey || event.altKey) return false
  if (event.key === "Backspace" && !event.shiftKey) {
    // ⌘⌫ deletes the line, as in Terminal.app: Ctrl+U to the shell.
    term.input("\x15", true)
    return true
  }
  if (event.code === "KeyC" || event.code === "KeyV") return false
  return event.key.length === 1
}

/**
 * A terminal drawn by ghostty-web. The shell runs in the core, so drawing this view again reattaches
 * to the same shell, and the core replays what it showed.
 */
export function TerminalView(props: { id: string }) {
  let container!: HTMLDivElement
  const cleanups: (() => void)[] = []
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const cleanup of cleanups) cleanup()
  })

  onMount(async () => {
    const { mod, ghostty } = await loadGhostty()
    if (disposed) return
    const term: Terminal = new mod.Terminal({
      ghostty,
      fontSize: 12,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10_000,
      theme: terminalTheme(),
    })
    term.attachCustomKeyEventHandler((event) => handleCommandKey(term, event))
    const fit: FitAddon = new mod.FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    cleanups.push(() => term.dispose())

    // Listen before opening, so the core's replay of earlier output is not missed.
    cleanups.push(
      core.listen((message) => {
        if (message.type === "terminal.output" && message.id === props.id) term.write(message.data)
        if (message.type === "terminal.exit" && message.id === props.id) term.write("\r\n\x1b[2m[Process exited]\x1b[0m\r\n")
      }),
    )
    core.send({ type: "terminal.open", id: props.id, cols: term.cols, rows: term.rows })

    const input = term.onData((data) => core.send({ type: "terminal.input", id: props.id, data }))
    const resize = term.onResize(({ cols, rows }) => core.send({ type: "terminal.resize", id: props.id, cols, rows }))
    cleanups.push(() => input.dispose(), () => resize.dispose())

    // A hidden view has no size. Fitting it then would shrink the shell to nothing.
    const observer = new ResizeObserver(() => container.clientWidth > 0 && container.clientHeight > 0 && fit.fit())
    observer.observe(container)
    cleanups.push(() => observer.disconnect())
    // A theme change recolours the open terminal. onMount awaited the WASM above, which left Solid's owner behind, so the effect gets a root of its own.
    createRoot((dispose) => {
      cleanups.push(dispose)
      createEffect(on(appliedScheme, () => (term.options.theme = terminalTheme()), { defer: true }))
    })
    term.focus()
  })

  return <div ref={container} class="desk-terminal relative h-full w-full overflow-hidden" />
}
