# AGENTS.md

Desk is a Mac workspace for working with coding agents. It wraps Claude Code in a UI: the thread, tool calls and diffs render as UI, not as a terminal. Spaces, setups and cards let the user shape a window around one job.

Desk replaces Rune (`~/scmmishra/rune`), a Swift app. Rune's docs and glossary carry over where they still apply.

Always build code cleanly, modularly, and with proper architecture and separation of concerns. Never simply bolt on a feature because I asked for it. If you can’t find an easy way to build it naturally, and you'd recommend a refactor to make the whole thing cleanly, stop your work ahead of time and say so.

## Rules

- Keep Desk minimal and easy to understand. Do not add features or dependencies without a clear need.
- Performance is a requirement. Opening a tab, switching tabs and toggling a pane must feel instant.
- Commit in small steps with conventional commit messages.
- Document workarounds and platform quirks with a short comment that says why.

## Structure

- `core/` is a Bun process. It owns sessions, the Claude Agent SDK, Git, PTYs, commands and space data, for every project the window's tabs work in. Later it also owns cards, variables and the MCP server.
- `app/` is Electron with Solid and `@opencode/ui`. It is a thin client: it draws what the core sends. Its state lives in four modules by concern: `workspace.ts` (tabs and what shows), `threads.ts` (each tab's thread), `projects.ts` (what is read about each project) and `account.ts` (settings, models and usage).
- `protocol/` holds the message types the two share. They talk JSON over one WebSocket on loopback, guarded by a token. `protocol/src/fixtures.ts` holds one core message of each type the native app reads.
- `native/` is the Rune app that will replace `app/`. It is a second client of the same core and runs it as its own instance, keeping its window in `~/.desk/native`. `mise run native:dev` runs it and `mise run native:test` tests it. Its protocol types are written by hand for the messages it reads, and its tests decode the fixtures.

Keep logic in the core. The UI is moving to Rune, Anomaly's Rust framework, and the core stays as it is.

## UI components

Build the UI from `@opencode/ui`. Anomaly's Rust framework ships `rune-kit`, whose components match `@opencode/ui` by name, variant and state. Screens built from it port to Rust by name.

- Before you write a component, look for one in `@opencode/ui`. Its `package.json` exports list what it has. Its stories in `~/scmmishra/reference/opencode/packages/ui` show how to use each one.
- Use the component as it is. Change its look with a class only when Desk's design needs it.
- Take icons from its catalog through `app/src/renderer/icons.tsx`. Add a Desk glyph there only when the catalog has no icon for the job.
- Colour with Desk's tokens. `index.css` points `@opencode/ui`'s tokens at Desk's palette, so its components draw in Desk's colours. Add a token to that bridge when a component reads one it lacks.
- Write a component of your own only when no component fits. Say why in a comment.

## Run

- `mise run install` builds Desk.app and installs it in `/Applications`. If Desk is running, Desk quits, updates and opens again. `mise run package` only builds it, in `dist/mac-arm64`. The app carries the core's source, its packages and a Bun binary, and is signed ad hoc for this Mac. It runs the Claude Code installed on the Mac, found as `claude` on the login shell's PATH. Set `DESK_CLAUDE` to run another.
- `bin/desk <folder>` opens the folder in a new tab of the installed Desk. Link it onto your PATH to use `desk .`.
- A window with no tabs opens on the most recent project, else asks for a folder. ⌘O opens a folder in a new tab.
- One Desk runs at a time, with one window. Its tabs are saved in `~/.desk/window.json`.
- `mise run dev` starts Desk Dev, which runs beside the installed Desk. It has an amber icon and keeps its tabs and plugin builds in `~/.desk/dev`. Settings, commands and plugins are shared. `DESK_DIR=<folder> mise run dev` opens a folder in it.
- Desk Dev starts the core with `bun` from `PATH`. Set `DESK_BUN` to use another binary. The core needs Bun 1.4 or newer.
- `assets/logo.svg` and `assets/logo-dark.svg` are the logo in light and dark. `mise run icons` renders them into `app/build`. Commit what it writes.
- `mise run check` typechecks, runs the core and app tests, and builds the app.

## Release

- The version in `app/package.json` is Desk's version. Desk.app shows it.
- Changes go in `CHANGELOG.md` under `## Unreleased` until they ship. CI fails when the version has no section.
- To release, rename `## Unreleased` to the new version, set the version in `app/package.json` to match, and push to `main`. Then start the Release workflow by hand. It publishes `Desk-arm64.zip` as the GitHub release `v<version>`, with the version's section as its notes.
- Desk has no auto-update yet. `mise run install` updates the installed Desk from the checkout.

## Check the UI

Do not take screen captures. Start the app with `DESK_DEBUG_PORT=9333`, then drive the page with agent-browser: `agent-browser connect 9333`, `snapshot -i`, `fill`, `press`, `get text`, and `screenshot` of the page.

Menu shortcuts such as ⌘K never reach the page from agent-browser, because the main process handles them. In development, run the same command from the page instead: `window.__deskCommand({ id: "palette.toggle" })`. The commands are listed in `app/src/shared/commands.ts`.

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

- A Desk started from inside Claude Code inherits that session's `CLAUDECODE` and `CLAUDE_CODE_*` variables. Claude sessions that Desk starts would then take themselves for children of that session. The core removes those variables at start, by prefix.
- `@opencode/ui`'s Tabs select their first tab when the chosen one has no trigger yet, and report it as a change. A tab must exist before it is selected. The view pane gives its Tabs a new choice one update late for this.
- `@opencode/ui`'s `menu.css` sits outside Tailwind's layers. Its rules beat utility classes, so an override needs `!`.
- An `@opencode/ui` popover closes when focus leaves its content. A menu inside a popover must render without `Menu.Portal`.
- `@opencode/ui`'s Tabs put each tab's value in a CSS selector without escaping it. A value must not hold quotes, so panel instance ids are URI-encoded.
- `@opencode/ui`'s `showToast` gives a toast with only a description an empty title, which draws as a blank line above the text. `index.css` hides an empty toast title.
- `@opencode/ui` names its source before its types, so TypeScript checks its `.tsx` files under the app's tsconfig. The app's tsconfig turns off `verbatimModuleSyntax` and uses the ES2025 lib for that.
