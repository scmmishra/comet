# Moving the app to Rune

Desk's UI moved from Electron and Solid to Rune, Anomaly's Rust framework. The app lives in `native/`. The Bun core stayed as it was, with the Agent SDK, Git, PTYs, commands and plugins. The protocol stayed JSON over one loopback WebSocket.

The work went in phases, and all of them are done. The Electron app stayed the shipped Desk until the last phase, which removed it. This file records the move and the gaps Rune still leaves.

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
- The single instance is a file lock in the instance's folder. Rune's `single_instance` covers only Windows, so a second launch exits. `bin/desk` hands a folder to the running Desk through a `desk://open?dir=` link instead, which the bundle declares.

### Phase 2: Thread

Done so far:

- Tabs: new (⌘T and the + button, ⌘-click opens next to the active tab), close, reorder by dragging, reopen (⌘⇧T) and Open Folder (⌘O). The app sends `tabs.save` with whole tabs: fields it does not read travel back unchanged.

- The core lays out each thread's rows and sends them as `session.rows`, after a thread's history and whenever an event changes them. Rows hold item ids. The Electron app puts its items into them (`resolveRows`), and the native app will too.

- The core names each step: tool and thinking items carry their `kind` and `label`, and each group row its `summary`. The rules moved from the app's `work.ts` to the core: `core/src/agents/steps.ts` names the steps, and `core/src/thread-rows.ts` sums each group.

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

- Terminals in the pane (Ctrl+` or the + button). The shell runs in the core, as before. The screen comes from `alacritty_terminal`, a pure Rust engine, behind `terminal.rs`, until Rune has a terminal of its own. Rows draw as text on a grid of cells, with wide characters in their own cells. Keys follow xterm's encoding, ⌘V pastes, bracketed when asked, and ⌘⌫ deletes the line. A drag selects text, a double click a word and a triple click a line, and ⌘C copies it. A program that tracks the mouse hears presses, drags and the wheel in xterm's encodings, and Shift still selects. In a full-screen program that does not track the mouse, the wheel sends arrow keys. The input method works at the cursor, for accents, CJK, emoji and dictation.

Still to do:

- Syntax colours in the file view, and Review's per-file "open" button.
- In the terminal, the mouse reports only the primary button. Box-drawing characters come from a fallback font, so lines may not join.
- Done when daily coding work needs no Electron.

### Phase 4: The rest

Done:

- Toasts for the core's errors and notices, refused attachments and the first Escape's hint.
- The command palette (⌘K), opened on threads by ⌘⇧O and on files by ⌘P. It lists themes and settings pages too.
- Cards beside the thread: the Space card, the Commands card and subagents.
- The background commands row above the composer, with its Stop.
- The minimap rail.
- Plugin views: sidebars, panels, cards and setups, drawn from the core's primitives.
- Meters: the context ring and the usage button.
- Settings (⌘,): Providers, Appearance, Projects, MCP servers and Skills. Showing a tab closes them, as in the Electron app.


### Phase 5: Switch

Done:

- `scripts/package.sh` builds the native Desk.app: the release binary, the core and Bun in `Contents/Resources`, the icon from `Desk.icon` through `actool`, and the `desk:` scheme. It is signed ad hoc. `mise run install`, the CI and Release workflows and `bin/desk` use it.
- A bundled Desk finds its core in its own resources and serves the main instance, `~/.desk`. Run from the repo, it keeps the `native` instance, since the Electron Desk Dev owns `~/.desk/dev` under a lock of its own.
- `AGENTS.md` describes the native app, its tasks and Rune's headless checks.

- `app/` is gone. Desk's version is `native/Cargo.toml`'s, and its icon is `native/assets/Desk.icon`.

Left:

- The dev instance can take the name `dev`, now that no other Desk owns `~/.desk/dev`.

## Open decisions

- **The tab bar.** Rune's `TabStrip` draws OpenCode's tabs: 13 px medium text and OpenCode's widths. The Electron app draws its own: 210 px tabs with 12 px regular text and the project mark. Either Desk builds its own tab bar in Rune, or the theme changes `ui_compact`, which other components also read.
- **The project mark.** `@opencode/ui`'s avatar draws generated art for a project with no colour or icon. The native app draws the initial on a gray tile there.

## Rune gaps

- No terminal or cell-grid text. Desk uses `alacritty_terminal` and draws rows as text until Rune adds one. libghostty-vt was set aside: its build needs Zig 0.15.2 and an SDK pin.
- Rune keeps winit's Quit on ⌘Q, so the press-twice quit cannot take that key.
- Markdown messages are their own selection group, so a drag stops at a message's end. `.selection_group(false)` works around it.
- `Collapsible` builds its content even when closed.
- `DiffView` scrolls on its own, so it needs a height inside a thread row.
- `DiffView` draws its own file headers and fixes its syntax colours and code font. Desk keeps a copy of it in `native/src/diff_view`, with hooks for all three, so Review matches the Electron app. anomalyco/rune#576 asks for the hooks upstream. Once they land, Desk goes back to rune-kit's.
- Markdown block margins are fixed in rune-kit: 12 points where the Electron app sets 10.4.
- rune-kit's Markdown draws an icon only before a link to a web page, so a file link in a reply has no file icon.
- A growth stack cannot grow virtual rows open, and holds removed rows 0.15 s before it closes up. Review's files fold at once for this.
- Text has no unbreakable span, so inline code wraps at its spaces. No-break spaces would keep it whole, but a copied command would then carry them.
- Rune has no left-start placement, so a subagent's detail centres beside its row.
- rune-kit's `Dialog` keeps its title and description to one line each, and a long one runs past the panel and pushes the close button out. Desk puts longer text in the dialog's body, where it wraps. A `Checkbox` description keeps to one line too, so Desk keeps it short.

## Desk's design rules

The native app was matched against the Electron app, which was built from `@opencode/ui`. Its look, icons and type carry over. A few rules that are easy to miss:

- Desk's own text is weight 400 on a 1.5 line. Only `@opencode/ui` components use the kit's 440 and 530.
- Every `<Icon>` draws at 15 points, whatever size class it is given (`icons::SIZE`).
- In the design, a border takes room, as in CSS, and an outline drawn as a shadow does not. Rune's borders take no room, so a native element with a design border adds its width to its padding.
- rem values shrink by Desk's 13 pixel root: `@opencode/ui`'s popover radius is 4.875 points, not 6.
