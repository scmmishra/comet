# Changelog

All notable changes to Comet are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `native/Cargo.toml` as that release's notes.

## Unreleased

- A task list's checkbox in Markdown has a gap before its text. Before, the box touched the text.
- A plugin's Markdown scrolls when it is taller than its panel. Before, the panel cut it off.
- An Antigravity turn that an API error stopped now shows as failed, with the error's message. Before, the error line showed as Antigravity's reply. A thread whose saved thinking the model rejects says it can no longer go on, so you start a new one.
- Settings reads the Antigravity sign-in from the Mac's keychain, where the `agy` CLI keeps it. Before, it looked for a file the CLI never writes, so a new sign-in could still show as signed out.
- A task handed to Claude waits for the subagents Claude runs in the background, and answers with what Claude says once they finish. Before, it returned Claude's "still running" message. A task that is stopped between turns now reads as stopped, with its last report.
- When a Codex hook stops a turn, the thread shows the hook's reason. A delegated Codex task that a hook stops reads as failed, with that reason.
- A Claude subagent that is resumed keeps the steps and summary of its earlier run.
- Comet runs on a newer Rune. Long threads lay out their Markdown faster. A scroll area inside the thread no longer traps the mouse wheel. Icons follow OpenCode's current catalog, so a command step shows a boxed console mark and Changes shows a plain ±.
- A plugin's messages draw their Markdown, and their links open in the browser.
- An agent can show a visual in the thread: a table, a bar or line chart, a Mermaid diagram and buttons for what to ask next. It sends the data and Comet draws it. A press of a button sends its text as your next message. Claude and Codex have it. Antigravity does not, because its tool calls do not say which tool they call.
- A Mermaid block in a reply draws as a diagram.
- An image file opens as a picture in the view pane, fitted to the pane. A pinch or ⌘ and the wheel zoom it, and the wheel or a drag pans it. PNG, JPEG, GIF, WebP, BMP and ICO files open this way.

## 0.1.0

- Desk is now Comet, with a new logo. On its first start, Comet moves your data from `~/.desk` to `~/.comet`. Quit Desk first, because Comet does not start while Desk runs. Links use `comet://`, the command is `comet` and environment variables start with `COMET_`. Plugins import `@comet/plugin` instead of `@desk/plugin`.
- Comet works in Git worktrees. A new tab can start its thread in the main checkout, in a worktree that exists, or in a new one under `~/.comet/worktrees/`. A Claude or Codex thread moves into a worktree when you ask the agent to work in one. A repo shows once among recent projects, with the threads of all its worktrees.
- Comet runs Antigravity as Google's `agy` CLI. Settings installs it and updates it from Google's release channel. Antigravity offers Supervised, Auto-accept edits and Auto.
- Comet has a second colour theme, Verdigris by Karan Sharma, with a light and a dark flavour. Settings › Appearance shows each theme as a card. Mode tiles for System, Light and Dark replace the Theme menu.
- The session header has a button for the project's MCP servers and skills, for Claude Code and Codex. A server turns on or off from its row. Settings no longer has MCP servers and Skills pages.
- A Markdown file opens as a rendered preview. A switch in its header shows its source.
- Tabs can be dragged to a new place. A middle click closes a tab. `/rename` in a Claude thread renames its tab.
- Search in the command palette ignores accents and full-width letters. ⌘P and ⌘⇧O switch the open palette between files and threads.
- In a terminal, Option works as the Alt key. A terminal draws again only the rows that changed, and a screen reader reads it row by row.
- A stop says when it waits, and offers Force stop if the agent does not answer. Retry notices show while an agent retries and go when the retry works. A Codex turn that hears nothing for 10 minutes after a retry fails.
- A message steered into a Claude turn says "Waiting to steer" until Claude takes it in. Claude Code's notices, plugins it could not load, and MCP servers Codex could not start show in the thread.
- Codex in full access accepts MCP prompts. A Codex turn asks for the reasoning summary that Codex's config sets. An image Codex makes shows as a step with its prompt.
- Review and the Space card read more kinds of changed files correctly, and count changes the same way. When they cannot read the changes, they say why.
- Comet starts, quits and runs Git faster. A thread's first message waits at most 5 seconds for its checkpoint. Comet gives back memory while it sits idle.
- Comet runs on a newer Rune, with faster text layout and better screen reader and input method support.
- Tool calls, subagents and turns no longer stay running after an agent stops, exits or fails.

## 0.0.1

- The first release of Desk, a Mac workspace for coding agents. It is a native app built in Rust with Rune. The thread, tool calls and diffs render as UI, not as a terminal.
- Desk runs Claude Code, Codex and Antigravity. Each uses the login and the plan it already has on this Mac. No API key is needed. One agent can hand a task to another, and the answer comes back to the thread.
- Tabs from several projects share one window. Each tab keeps its thread, its draft and its view pane. Messages can carry images, `@` files and `/` commands, and can steer or queue while a turn runs.
- A thread can be rewound, forked, renamed or deleted. Review shows the thread's, Git's, the branch's or the last turn's changes. Subagents and background commands each have a card.
- Plugins in `~/.desk/plugins` add sidebars, panels, cards, setups and commands. `docs/plugins.md` describes them.
- `mise run install` builds Desk.app and installs it in `/Applications`. `desk <folder>` opens a folder in the running Desk.
