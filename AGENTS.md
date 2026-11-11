# AGENTS.md

Desk is a Mac workspace for working with coding agents. It wraps Claude Code in a UI: the thread, tool calls and diffs render as UI, not as a terminal. Spaces, setups and cards let the user shape a window around one job.

Desk replaces the Swift app also called Rune (`~/scmmishra/rune`). Its docs and glossary carry over where they still apply. Below, Rune means Anomaly's Rust UI framework, which Desk is built with.

Always build code cleanly, modularly, and with proper architecture and separation of concerns. Never simply bolt on a feature because I asked for it. If you can’t find an easy way to build it naturally, and you'd recommend a refactor to make the whole thing cleanly, stop your work ahead of time and say so.

## Rules

- Keep Desk minimal and easy to understand. Do not add features or dependencies without a clear need.
- Performance is a requirement. Opening a tab, switching tabs and toggling a pane must feel instant.
- Commit in small steps with conventional commit messages.
- Document workarounds and platform quirks with a short comment that says why.

## Structure

- `core/` is a Bun process. It owns sessions, the Claude Agent SDK, Git, PTYs, commands and space data, for every project the window's tabs work in. Later it also owns cards, variables and the MCP server.
- `native/` is Desk: a Rust app built with Rune and `rune-kit`. It is a thin client: it draws what the core sends. Its state lives in modules by concern, such as `workspace.rs` (tabs and what shows), `threads.rs` (each tab's thread), `projects.rs` (what is read about each project) and `account.rs` (settings, models and usage).
- `protocol/` holds the message types the core and its clients share. They talk JSON over one WebSocket on loopback, guarded by a token. The native app's types are written by hand in `native/src/protocol.rs` for the messages it reads. `protocol/src/fixtures.ts` holds one core message of each type, and the native tests decode them.
- `app/` is the Electron Desk that `native/` replaced, with Solid and `@opencode/ui`. It stays buildable until it goes. `docs/rune-port.md` records the move.

Keep logic in the core. The clients only draw it.

## UI components

Build the UI from `rune-kit`. Its components match `@opencode/ui` by name, variant and state, and Desk's look follows the Electron app, which was built from `@opencode/ui`.

- Before you write a component, look for one in `rune-kit`. OpenCode's stories in `~/scmmishra/reference/opencode/packages/ui` show how each one is meant to look and behave.
- Use the component as it is. Change its look only when Desk's design needs it.
- Take icons from `rune-theme-opencode` through `native/src/icons.rs`. Add a Desk glyph there only when the catalog has no icon for the job.
- Colour with Desk's tokens. `native/src/theme.rs` points the kit's colours at Desk's palette. Add a colour there when a component needs one.
- Write a component of your own only when no component fits. Say why in a comment. Do not patch Rune. A gap Rune leaves goes in `docs/rune-port.md`.

## Run

- `mise run install` builds Desk.app and installs it in `/Applications`. If Desk is running, Desk quits, updates and opens again. `mise run package` only builds it, in `dist/mac-arm64`. The app carries the core's source, its packages and a Bun binary in `Contents/Resources`, and is signed ad hoc for this Mac. It runs the Claude Code installed on the Mac, found as `claude` on the login shell's PATH. Set `DESK_CLAUDE` to run another.
- `bin/desk <folder>` opens the folder in a new tab of the installed Desk, through the link `desk://open?dir=<folder>`. Link it onto your PATH to use `desk .`.
- A window with no tabs opens on the most recent project, else asks for a folder. ⌘O opens a folder in a new tab.
- One Desk runs at a time, with one window. Its tabs are saved in `~/.desk/window.json`.
- `mise run dev` runs Desk from the repo with `cargo run`. It keeps its tabs and plugin builds in `~/.desk/native`, so it runs beside the installed Desk. Settings, commands and plugins are shared. `DESK_DIR=<folder> mise run dev` opens a folder in it.
- A Desk run from the repo starts the core with `bun` from `PATH`. Set `DESK_BUN` to use another binary. The core needs Bun 1.4 or newer.
- `mise run test` runs the core and native tests. `mise run check` typechecks, lints, runs every test and builds the Electron app.
- `mise run electron:dev` and `mise run electron:package` run and build the Electron Desk. Its Desk Dev keeps `~/.desk/dev`.
- `assets/logo.svg` and `assets/logo-dark.svg` are the logo in light and dark. `mise run icons` renders them into `app/build`, which both apps read. Commit what it writes.

## Release

- The version in `app/package.json` is Desk's version. `scripts/package.sh` writes it into Desk.app's `Info.plist`.
- Changes go in `CHANGELOG.md` under `## Unreleased` until they ship. CI fails when the version has no section.
- To release, rename `## Unreleased` to the new version, set the version in `app/package.json` to match, and push to `main`. Then start the Release workflow by hand. It publishes `Desk-arm64.zip` as the GitHub release `v<version>`, with the version's section as its notes.
- Desk has no auto-update yet. `mise run install` updates the installed Desk from the checkout.

## Check the UI

Do not take screen captures. Rune runs Desk headless, with no window and no core, so a check never touches the running Desk:

- `cargo run -- --scene thread --snap out.png` renders a scene to a PNG. `--tree out.json` writes the accessibility tree instead, with each element's key, role, label and rect. `--size 1280x820`, `--theme light` and `--at <seconds>` set the window, the theme and the moment.
- `src/scenes.rs` lists the scenes. The `file` scene takes core messages from the JSON file `DESK_SCENE_FILE` names, so any thread, review or plugin view can be drawn from data.
- `--script events.json` replays input: `tap`, `move`, `drag`, `wheel`, `type`, `key` and `paste`, each at a time `t`. A text field takes keys only once a tap has focused it.
- A headless run has no input method events, no system clipboard and no core. Check those in the installed app.

The Electron app is checked with agent-browser, as `app/` describes: start it with `DESK_DEBUG_PORT=9333`, then `agent-browser connect 9333`.

## References

T3 Code and OpenCode are cloned in `~/scmmishra/reference`. T3 Code's server shows how to drive the Agent SDK and shape thread items. OpenCode's `packages/ui` and `packages/session-ui` show how `@opencode/ui` is meant to be used.

## Glossary

- **Space.** A repo and its branch.
- **Tab.** One top tab of the window. A tab is a session in one project. Tabs from several projects share the window.
- **Session.** One Claude conversation in a tab.
- **Thread.** The messages of a session, as Desk draws them.
- **Plugin.** A TSX module in `~/.desk/plugins` that adds sidebars, panels, cards, setups and commands. `docs/plugins.md` describes it.
- **Setup.** A starting layout for a tab, registered by a plugin: a sidebar, panels and cards to leave out.
- **Card.** One unit of information in the card stack beside the thread, such as the Space card.
- **View pane.** The pane beside the thread that holds Review, terminals, open files and plugin panels.

## Known quirks

- An app opened from the Dock or Finder starts with launchd's short PATH. The core takes the login shell's PATH at start (`core/src/main.ts`), so Claude Code and the tools Desk runs find the user's.
- A Rune popover anchored to an element inside another popover must go into the overlay layer after that popover. Ahead of its anchor, it opens in the window's corner.

- A Desk started from inside Claude Code inherits that session's `CLAUDECODE` and `CLAUDE_CODE_*` variables. Claude sessions that Desk starts would then take themselves for children of that session. The core removes those variables at start, by prefix.
- The quirks below are the Electron app's.
- `@opencode/ui`'s Tabs select their first tab when the chosen one has no trigger yet, and report it as a change. A tab must exist before it is selected. The view pane gives its Tabs a new choice one update late for this.
- `@opencode/ui`'s `menu.css` sits outside Tailwind's layers. Its rules beat utility classes, so an override needs `!`.
- An `@opencode/ui` popover closes when focus leaves its content. A menu inside a popover must render without `Menu.Portal`.
- `@opencode/ui`'s Tabs put each tab's value in a CSS selector without escaping it. A value must not hold quotes, so panel instance ids are URI-encoded.
- `@opencode/ui`'s `showToast` gives a toast with only a description an empty title, which draws as a blank line above the text. `index.css` hides an empty toast title.
- `@opencode/ui` names its source before its types, so TypeScript checks its `.tsx` files under the app's tsconfig. The app's tsconfig turns off `verbatimModuleSyntax` and uses the ES2025 lib for that.
