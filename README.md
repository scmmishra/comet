# Desk

Give your agents a desk, not a terminal.

Desk is a desktop app for working with coding agents. It runs the agent installed on your machine and draws each session as a thread: messages, tool calls and diffs show as UI, not as terminal output.

Each tab is one session in one project, and tabs from several projects share the window. Beside the thread, a stack of cards shows the project's branch, its changes and its commands. A view pane holds Review, terminals and open files. Plugins can add sidebars, panels, cards and commands, so you can shape the window around each job.

Desk is early. Today it runs Claude Code, on Apple silicon Macs. Codex and Linux are planned, and so are agents that can act in Desk itself, such as opening a panel or filling a card for the task.

## Install

Desk needs [Claude Code](https://code.claude.com), installed and logged in. Desk finds it as `claude` on your shell's `PATH`.

Download `Desk-arm64.zip` from the [latest release](https://github.com/scmmishra/desk/releases), unzip it and move `Desk.app` to `/Applications`. Desk is not notarized. If macOS refuses to open it, allow it in System Settings › Privacy & Security.

To open a folder from a terminal, link `bin/desk` onto your `PATH` and run `desk .`.

## Build from source

You need [mise](https://mise.jdx.dev) and a Rust toolchain. mise installs the right Bun.

```sh
mise install
bun install
mise run install   # build Desk.app and install it in /Applications
```

| Task | What it does |
|---|---|
| `mise run dev` | Runs Desk from the repo, beside the installed one. |
| `mise run test` | Runs the core and native tests. |
| `mise run check` | Typechecks, lints and runs every test. |
| `mise run package` | Builds `Desk.app` in `dist/mac-arm64`. |

## How it is built

- `core/` is a Bun process. It runs the agent, Git, terminals and plugins.
- `native/` is the app, written in Rust with Rune. It draws what the core sends.
- `protocol/` holds the messages the two exchange over a local WebSocket.

`AGENTS.md` describes the project in more detail. `docs/plugins.md` describes plugins, and `examples/plugins/support` is a sample plugin.

## Changelog

See `CHANGELOG.md`.
