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
- `protocol/` holds the message types the two share. They talk JSON over one WebSocket on loopback, guarded by a token.

Keep logic in the core. The UI may later move to Anomaly's Rust framework, and the core stays as it is.

## UI components

Build the UI from `@opencode/ui`. Anomaly's Rust framework ships `rune-kit`, whose components match `@opencode/ui` by name, variant and state. Screens built from it port to Rust by name.

- Before you write a component, look for one in `@opencode/ui`. Its `package.json` exports list what it has. Its stories in `~/scmmishra/reference/opencode/packages/ui` show how to use each one.
- Use the component as it is. Change its look with a class only when Desk's design needs it.
- Take icons from its catalog through `app/src/renderer/icons.tsx`. Add a Desk glyph there only when the catalog has no icon for the job.
- Colour with Desk's tokens. `index.css` points `@opencode/ui`'s tokens at Desk's palette, so its components draw in Desk's colours. Add a token to that bridge when a component reads one it lacks.
- Write a component of your own only when no component fits. Say why in a comment.

## Run

- `mise run dev` starts the app. A window with no tabs opens on the most recent project, else asks for a folder. ⌘O opens a folder in a new tab. The core keeps recent projects in `~/.desk/window.json`.
- `bin/desk <folder>` opens the folder in a new tab, in the running Desk if there is one. Link it onto your PATH to use `desk .`.
- One Desk runs at a time, with one window. Its tabs are saved in `~/.desk/window.json`.
- The app starts the core with `bun` from `PATH`. Set `DESK_BUN` to use another binary. The core needs Bun 1.4 or newer.
- `mise run check` typechecks, runs the core and app tests, and builds the app.

## Check the UI

Do not take screen captures. Start the app with `DESK_DEBUG_PORT=9333`, then drive the page with agent-browser: `agent-browser connect 9333`, `snapshot -i`, `fill`, `press`, `get text`, and `screenshot` of the page.

Menu shortcuts such as ⌘K never reach the page from agent-browser, because the main process handles them. In development, run the same command from the page instead: `window.__deskCommand({ id: "palette.toggle" })`. The commands are listed in `app/src/shared/commands.ts`.

## References

T3 Code and OpenCode are cloned in `~/scmmishra/reference`. T3 Code's server shows how to drive the Agent SDK and shape thread items. OpenCode's `packages/ui` and `packages/session-ui` show how `@opencode/ui` is meant to be used.

## Glossary

- **Space.** A repo and its branch.
- **Tab.** One top tab of the window. A tab is a session in one project, and later also a setup. Tabs from several projects share the window.
- **Session.** One Claude conversation in a tab.
- **Thread.** The messages of a session, as Desk draws them.
- **Setup.** A named space with its own cards and bindings. Not built yet.
- **Card.** One unit of space information, such as the Space card.
- **View pane.** The pane beside the thread that holds Review, Terminal and other views. Not built yet.

## Known quirks

- A Desk started from inside Claude Code inherits that session's `CLAUDECODE` and `CLAUDE_CODE_*` variables. Claude sessions that Desk starts would then take themselves for children of that session. The core removes those variables at start, by prefix.
- `@opencode/ui`'s Tabs select their first tab when the chosen one has no trigger yet, and report it as a change. Add a tab before you select it.
- `@opencode/ui`'s `menu.css` sits outside Tailwind's layers. Its rules beat utility classes, so an override needs `!`.
- An `@opencode/ui` popover closes when focus leaves its content. A menu inside a popover must render without `Menu.Portal`.
- `@opencode/ui` names its source before its types, so TypeScript checks its `.tsx` files under the app's tsconfig. The app's tsconfig turns off `verbatimModuleSyntax` and uses the ES2025 lib for that.
