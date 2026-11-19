# Comet

Comet is a desktop app for working with coding agents. It runs the agent installed on your machine and draws each session as a thread: messages, tool calls and diffs show as UI, not as terminal output.

Each tab is one session in one project, and tabs from several projects share the window. Beside the thread, a stack of cards shows the project's branch, its changes and its commands. A view pane holds Review, terminals and open files. Plugins can add sidebars, panels, cards and commands, so you can shape the window around each job.

Comet is early. Today it runs Claude Code, Codex and Antigravity, on Apple silicon Macs. Each uses the login and the plan it already has, and one agent can hand a task to another. Linux is planned, and so are agents that can act in Comet itself, such as opening a panel or filling a card for the task.

## Install

Comet needs at least one agent, installed and logged in. It finds [Claude Code](https://code.claude.com) as `claude` and Codex as `codex` on your shell's `PATH`. Antigravity installs from Settings › Providers, where you sign in with your Google account.

Download `Comet-arm64.zip` from the [latest release](https://github.com/scmmishra/comet/releases), unzip it and move `Comet.app` to `/Applications`. Comet is not notarized. If macOS refuses to open it, allow it in System Settings › Privacy & Security.

Comet puts the `comet` command in `~/.local/bin` when it starts. Run `comet` in a folder to open it, `comet "<prompt>"` to start a thread there, or `comet plugin` to manage plugins. If your shell does not find it, add `~/.local/bin` to your `PATH`. Comet leaves a `comet` that is already there alone.

## Build from source

You need [mise](https://mise.jdx.dev) and a Rust toolchain. mise installs the right Bun.

```sh
mise install
bun install
mise run install   # build Comet.app and install it in /Applications
```

| Task | What it does |
|---|---|
| `mise run dev` | Runs Comet from the repo, beside the installed one. |
| `mise run test` | Runs the core, protocol and native tests. |
| `mise run check` | Typechecks, lints and runs every test. |
| `mise run package` | Builds `Comet.app` in `dist/mac-arm64`. |

## How it is built

- `core/` is a Bun process. It runs the agent, Git, terminals and plugins.
- `native/` is the app, written in Rust with Rune. It draws what the core sends.
- `protocol/` holds the messages the two exchange over a local WebSocket.

`AGENTS.md` describes the project in more detail. `docs/plugins.md` describes plugins, and `examples/plugins/support` is a sample plugin.

## Changelog

See `CHANGELOG.md`.
