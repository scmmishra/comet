# Desk

Desk is a Mac app for working with Claude Code. It runs the Claude Code installed on your Mac and draws each session as a thread: messages, tool calls and diffs show as UI, not as terminal output.

Each tab is one session in one project, and tabs from several projects share the window. Beside the thread, a stack of cards shows the project's branch, its changes and its commands. A view pane holds Review, terminals and open files. Plugins can add sidebars, panels, cards and commands.

Desk is early. It runs on Apple silicon Macs only.

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

- `core/` is a Bun process. It runs the Claude Agent SDK, Git, terminals and plugins.
- `native/` is the app, written in Rust with Rune. It draws what the core sends.
- `protocol/` holds the messages the two exchange over a local WebSocket.

`AGENTS.md` describes the project in more detail. `docs/plugins.md` describes plugins, and `examples/plugins/support` is a sample plugin.

## Changelog

See `CHANGELOG.md`.
