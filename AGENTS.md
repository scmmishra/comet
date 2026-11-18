# AGENTS.md

Comet is a Mac workspace for working with coding agents. It wraps Claude Code, Codex and Antigravity in a UI: the thread, tool calls and diffs render as UI, not as a terminal. Spaces, setups and cards let the user shape a window around one job.

Comet replaces the Swift app also called Rune (`~/scmmishra/rune`). Its docs and glossary carry over where they still apply. Below, Rune means Anomaly's Rust UI framework, which Comet is built with.

Always build code cleanly, modularly, and with proper architecture and separation of concerns. Never simply bolt on a feature because I asked for it. If you can’t find an easy way to build it naturally, and you'd recommend a refactor to make the whole thing cleanly, stop your work ahead of time and say so.

## Rules

- Keep Comet minimal and easy to understand. Do not add features or dependencies without a clear need.
- Performance is a requirement. Opening a tab, switching tabs and toggling a pane must feel instant.
- Commit in small steps with conventional commit messages.
- Document workarounds and platform quirks with a short comment that says why.

## Structure

- `core/` is a Bun process. It owns sessions, the agents, Git, PTYs, commands and space data, for every project the window's tabs work in. Later it also owns cards and variables.
- `core/src/agents/` holds the agents Comet runs. `agent.ts` is the interface the rest of the core talks to: sessions, saved threads, and what an agent knows about its install, account and models. Each agent has a folder that turns its own messages into Comet's thread events: `claude/` drives the Claude Agent SDK, `codex/` talks to `codex app-server`, and `antigravity/` runs Google's `agy` CLI through the ACP client in `acp/`. `registry.ts` lists them. Nothing outside an agent's folder reads that agent's types. What every agent's session does the same way lives beside them: `turn-items.ts` (the user's message, a turn's result, an error), `requests.ts` (the requests that wait for the user), `stopping.ts` (a stop that waits for its turn to end), `steps.ts` (how a step is named) and `versions.ts` (which version is newer).
- `core/src/delegate/` lets one agent hand a task to another. It is an MCP server in the core that every session connects to, under a token of its own. Its `delegate` tool runs the task on the agent it names and shows it as a subagent of the thread.
- `native/` is Comet: a Rust app built with Rune and `rune-kit`. It is a thin client: it draws what the core sends. Its state lives in modules by concern, such as `workspace.rs` (tabs and what shows), `threads.rs` (each tab's thread), `projects.rs` (what is read about each project), `account.rs` (settings and the agents) and `agents.rs` (each agent's mark and words).
- `protocol/` holds the message types the core and its clients share. They talk JSON over one WebSocket on loopback, guarded by a token. The native app's types are written by hand in `native/src/protocol.rs` for the messages it reads. `protocol/src/fixtures.ts` holds one core message of each type, and the native tests decode them.
- `docs/rune-port.md` records the move from the Electron app, which Comet was until `native/` replaced it, and the gaps Rune still leaves.

Keep logic in the core. The clients only draw it.

## UI components

Build the UI from `rune-kit`. Its components match `@opencode/ui` by name, variant and state, and Comet's design comes from `@opencode/ui`. `docs/rune-port.md` lists the design rules that are easy to miss.

- Before you write a component, look for one in `rune-kit`. OpenCode's stories in `~/scmmishra/reference/opencode/packages/ui` show how each one is meant to look and behave.
- Use the component as it is. Change its look only when Comet's design needs it.
- Take icons from `rune-theme-opencode` through `native/src/icons.rs`. Add a Comet glyph there only when the catalog has no icon for the job.
- Colour with Comet's tokens. `native/src/theme.rs` points the kit's colours at Comet's palette. Add a colour there when a component needs one.
- Write a component of your own only when no component fits. Say why in a comment. Do not patch Rune. A gap Rune leaves goes in `docs/rune-port.md`.

## Run

- `mise run install` builds Comet.app and installs it in `/Applications`. If Comet is running, Comet quits, updates and opens again. `mise run package` only builds it, in `dist/mac-arm64`. The app carries the core's source, its packages and a Bun binary in `Contents/Resources`, and is signed ad hoc for this Mac. It runs the Claude Code and the Codex installed on the Mac, found as `claude` and `codex` on the login shell's PATH. Set `COMET_CLAUDE` or `COMET_CODEX` to run another. Antigravity is Google's `agy` CLI, which Comet installs into `~/.comet/agents/antigravity` from Settings and updates from Google's release channel. Set `COMET_ANTIGRAVITY` to run another `agy`, by path or by name.
- `bin/comet <folder>` opens the folder in a new tab of the installed Comet, through the link `comet://open?dir=<folder>`. Link it onto your PATH to use `comet .`.
- A window with no tabs opens on the most recent project, else asks for a folder. ⌘O opens a folder in a new tab.
- One Comet runs at a time, with one window. Its tabs are saved in `~/.comet/window.json`.
- `mise run dev` runs Comet from the repo with `cargo run`. It keeps its tabs and plugin builds in `~/.comet/native`, so it runs beside the installed Comet. Settings, commands and plugins are shared. `COMET_DIR=<folder> mise run dev` opens a folder in it.
- A Comet run from the repo starts the core with `bun` from `PATH`. Set `COMET_BUN` to use another binary. The core needs Bun 1.4 or newer.
- `mise run test` runs the core, protocol and native tests. `mise run check` typechecks, lints and runs every test.
- `assets/logo.svg` is the logo, which is black in light and dark mode alike. `mise run icons` renders it into `native/assets/Comet.icon`. Commit what it writes.

## Release

- The version in `native/Cargo.toml` is Comet's version. `scripts/package.sh` writes it into Comet.app's `Info.plist`.
- Changes go in `CHANGELOG.md` under `## Unreleased` until they ship. CI fails when the version has no section.
- To release, rename `## Unreleased` to the new version, set the version in `native/Cargo.toml` to match, and push to `main`. Then start the Release workflow by hand. It publishes `Comet-arm64.zip` as the GitHub release `v<version>`, with the version's section as its notes.
- Comet has no auto-update yet. `mise run install` updates the installed Comet from the checkout.

## Check the UI

Do not take screen captures. Rune runs Comet headless, with no window and no core, so a check never touches the running Comet:

- `cargo run -- --scene thread --snap out.png` renders a scene to a PNG. `--tree out.json` writes the accessibility tree instead, with each element's key, role, label and rect. `--size 1280x820`, `--theme light` and `--at <seconds>` set the window, the theme and the moment.
- `src/scenes.rs` lists the scenes. The `file` scene takes core messages from the JSON file `COMET_SCENE_FILE` names, so any thread, review or plugin view can be drawn from data.
- `--script events.json` replays input: `tap`, `move`, `drag`, `wheel`, `type`, `key` and `paste`, each at a time `t`. A text field takes keys only once a tap has focused it.
- A headless run has no input method events, no system clipboard and no core. Check those in the installed app.

## References

T3 Code and OpenCode are cloned in `~/scmmishra/reference`. T3 Code's server shows how to drive the Agent SDK and shape thread items. OpenCode's `packages/ui` and `packages/session-ui` show how `@opencode/ui` is meant to be used.

## Glossary

- **Space.** A repo and its branch.
- **Agent.** A coding agent Comet runs: Claude Code, Codex or Antigravity. Each uses the login and the plan it already has on this Mac.
- **Tab.** One top tab of the window. A tab is a session in one project, on one agent. Tabs from several projects share the window.
- **Session.** One conversation with an agent in a tab. A thread keeps the agent it started on.
- **Thread.** The messages of a session, as Comet draws them.
- **Plugin.** A TSX module in `~/.comet/plugins` that adds sidebars, panels, cards, setups and commands. `docs/plugins.md` describes it.
- **Setup.** A starting layout for a tab, registered by a plugin: a sidebar, panels and cards to leave out.
- **Card.** One unit of information in the card stack beside the thread, such as the Space card.
- **View pane.** The pane beside the thread that holds Review, terminals, open files and plugin panels.

## Add an agent

1. Add its id to `AGENTS` in `protocol/src/index.ts`, and its defaults to `DEFAULT_SETTINGS`.
2. Write `core/src/agents/<id>/index.ts`, which makes an `Agent` from an `AgentHost`. An agent that speaks ACP fills in an `AcpFlavor` and reuses `acp/`. List only the features it has. The core refuses the rest and the app does not offer them.
3. List it in `MAKERS` in `core/src/agents/registry.ts`.
4. Give it a mark and a colour in `native/src/agents.rs`.

Test an agent against a fake of its process on an in-memory transport, as `codex/test-app-server.ts` and `acp/test-agent.ts` do.

## Known quirks

- An app opened from the Dock or Finder starts with launchd's short PATH. The core takes the login shell's PATH at start (`core/src/main.ts`), so Claude Code and the tools Comet runs find the user's.
- A Rune popover anchored to an element inside another popover must go into the overlay layer after that popover. Ahead of its anchor, it opens in the window's corner.
- Antigravity's CLI takes its folder from `--gemini-dir` and `--app-data-dir`, not from GEMINI_HOME. Comet passes the folder that Google's ACP server, which Comet installed before, kept its sign-in in, so that sign-in carries over.
- Antigravity's `agy` keeps a session's first folder when Comet resumes it with another, and runs every command there. So an Antigravity thread never moves into a worktree. Claude Code finds a thread's transcript from any worktree of its repo, but resumes a thread in the worktree its EnterWorktree tool last entered, whatever folder Comet names. Codex resumes it in the folder Comet names, but lists it under the folder it started in, so Comet records where a moved thread runs.
- Codex asks before it calls an MCP tool in Supervised mode. Comet approves its own tools itself, so a Codex thread can hand work to another agent without a prompt for each call.
- A Comet started from inside Claude Code inherits that session's `CLAUDECODE` and `CLAUDE_CODE_*` variables. Claude sessions that Comet starts would then take themselves for children of that session. The core removes those variables at start, by prefix.

