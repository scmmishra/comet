# Moving the app to Rune

Desk's UI moves from Electron and Solid to Rune, Anomaly's Rust framework. The new app lives in `native/`. The Bun core stays as it is, with the Agent SDK, Git, PTYs, commands and plugins. The protocol stays JSON over one loopback WebSocket.

The work goes in phases. The Electron app stays the shipped Desk until the last phase. Each phase ends with something that runs.

## Why

Spikes on this Mac compared a Rune build with the Electron app:

- Scrolling the same long thread missed 0.9% of refreshes at 120 Hz in Rune, against 4.8% in Desk Dev. The worst hitch was 33 ms in Rune and 309 ms in Desk Dev.
- The whole Rune app used about 101 MB with one long thread. Desk Dev's renderer alone used 361 MB.
- libghostty-vt parsed plain text 6 to 9 times faster than ghostty-web, the engine Desk's terminal uses today.

## Phases

### Phase 1: Foundation (done)

- A `native/` crate, pinned to a Rune rev of `dev`.
- Rust protocol types for the messages the app reads.
- A core client: it starts Bun with a token, reads the port from the core's first line and connects over the WebSocket.
- A theme module that lays Desk's palette over the OpenCode kit, as `index.css` does for `@opencode/ui`.
- A window with Rune's tab strip, ⌘1 to ⌘9 in the View menu, and a single instance.
- Done: it opens, starts the core and lists the saved tabs.

What changed from the plan:

- The protocol types are written by hand, not generated. TypeScript 7 ships no JS compiler API, and a generator would need a second TypeScript or a schema toolchain. `protocol/src/fixtures.ts` holds one message of each type the app reads. The typecheck holds it to the protocol, and the native tests decode it.
- The fonts were first the OpenCode theme's, Inter and IBM Plex Mono, because Geist's npm package ships only woff2, which Rune does not read. The app now carries Geist's variable TTFs from Vercel's repo, in `native/assets/fonts`.
- The client does not reconnect. The Electron app's client does not either.
- The theme is a module in the crate, not a crate of its own.
- The single instance is a file lock in `~/.desk/native`. Rune's `single_instance` covers only Windows. A second launch exits. It does not hand its folder over yet.

### Phase 2: Thread

Done so far:

- Tabs: new (⌘T and the + button, ⌘-click opens next to the active tab), close, reorder by dragging, reopen (⌘⇧T) and Open Folder (⌘O). The app sends `tabs.save` with whole tabs: fields it does not read travel back unchanged.

- The core lays out each thread's rows and sends them as `session.rows`, after a thread's history and whenever an event changes them. Rows hold item ids. The Electron app puts its items into them (`resolveRows`), and the native app will too.

- The core names each step: tool and thinking items carry their `kind` and `label`, and each group row its `summary`. The rules moved from the app's `work.ts` to `core/src/steps.ts`.

- The thread, read-only: every row kind from the core's rows, drawn as `thread.tsx` draws them, inside `virtual_rows` with each row kept by `memo`. Folds, groups and steps open and close. It follows live events and text deltas, sticks to the bottom while it grows, and counts the working head's seconds. The session's header shows the project and the tab's title.
- `cargo run -- --snap thread.png --scene thread` renders a sample thread without a core, for checking the look.

- Sending: the composer, follow-ups while Claude works (steer or queue, ⌘ for the other), Escape twice to stop, permission answers, Claude's questions and the queue. A real turn runs through the core in `cargo test real_turn -- --ignored`.
- The model picker: model, effort, speed and permission mode, as `model-picker.tsx` has them.
- The start screen: the wordmark, the composer, the project switcher and branch, and recent threads to continue.

Still to do:

- Each message's copy button and time, images in messages, the shimmer on running labels and the retry note.
- The permission row's "More" menu: rows are built in `memo`, which has no overlay layer, so its choices show as buttons.
- The wordmark's fade toward the bottom, and number keys for Claude's options.

- The composer: text, the `@` and `/` lists, pills, images and drafts.
- Done when you can hold a real session in it.

### Phase 3: View pane

Done so far:

- The view pane beside the thread, opened by its toggle or ⌘\\, with a tab for Review and one per open file.
- Review: the scope picker, the counts, unified or split diffs, drawn by rune-kit's `DiffView` from the core's patches. It reads again when a turn ends.
- The file view: a file opened from the thread's changed files, with numbered lines and the line it opened at marked.

- Terminals in the pane (Ctrl+` or the + button). The shell runs in the core, as before. The screen comes from `alacritty_terminal`, a pure Rust engine, behind `terminal.rs`, until Rune has a terminal of its own. Rows draw as text on a grid of cells, with wide characters in their own cells. Keys follow xterm's encoding, ⌘V pastes, bracketed when asked, and ⌘⌫ deletes the line.

Still to do:

- Syntax colours in the file view, and Review's per-file "open" button.
- In the terminal: selection and copy, mouse reporting and IME. Box-drawing characters come from a fallback font, so lines may not join.
- Done when daily coding work needs no Electron.

### Phase 4: The rest

Done:

- Toasts for the core's errors and notices, refused attachments and the first Escape's hint.
- The command palette (⌘K), opened on threads by ⌘⇧O and on files by ⌘P. It lists themes and settings pages too.
- Cards beside the thread: the Space card, the Commands card and subagents.
- The minimap rail.
- Plugin views: sidebars, panels, cards and setups, drawn from the core's primitives.
- Meters: the context ring and the usage button.
- Settings (⌘,): Providers, Appearance, Projects, MCP servers and Skills. Showing a tab closes them, as in the Electron app.

Left out, for now:

- Appearance's interface and code font rows. The native app draws in Geist, which it bundles. It has no way yet to load a font by name.
- A project's icon in Projects, and the project's colour in its mark. Both wait on the project mark (see Open decisions).

### Phase 5: Switch

- Packaging and signing, `mise run install`, the release workflow and `bin/desk`.
- The core's path in a packaged build. Phase 1 finds the core through the repo path set at build time.
- The native app takes the main instance, in place of `native`.
- Rewrite `AGENTS.md`'s testing section for Rune's headless mode.
- Remove `app/`.

## Open decisions

- **The tab bar.** Rune's `TabStrip` draws OpenCode's tabs: 13 px medium text and OpenCode's widths. The Electron app draws its own: 210 px tabs with 12 px regular text and the project mark. Either Desk builds its own tab bar in Rune, or the theme changes `ui_compact`, which other components also read.
- **The project mark.** `@opencode/ui`'s avatar draws generated art. The native app draws the project's initial on a tile until it has an equivalent.

## Rune gaps

- No terminal or cell-grid text. Desk uses `alacritty_terminal` and draws rows as text until Rune adds one. libghostty-vt was set aside: its build needs Zig 0.15.2 and an SDK pin.
- Rune keeps winit's Quit on ⌘Q, so the press-twice quit cannot take that key.
- Markdown messages are their own selection group, so a drag stops at a message's end. `.selection_group(false)` works around it.
- `Collapsible` builds its content even when closed.
- `DiffView` scrolls on its own, so it needs a height inside a thread row.
