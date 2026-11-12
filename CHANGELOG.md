# Changelog

All notable changes to Desk are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `native/Cargo.toml` as that release's notes.

## Unreleased

- The Background card shows a multi-line command on one line, by its first line. The note that the agent picks up again wraps instead of running past the card.
- A dragged tab follows the pointer, and the tabs it passes slide aside. On release it slides into its place. The new order is saved once, on release.
- Review and turn summaries read every changed file right: a path with a tab, a quote or a backslash, a file that changed type, and a file past the size limit. Edits to files marked assume-unchanged or skip-worktree now show.
- Projects that share a repo, as folders or worktrees, no longer delete each other's checkpoints at start, and a plugin thread's checkpoints are kept while no tab shows it.
- The Space card counts changes as Review does: the project's folder only, new files with their lines, and staged files before the first commit. It reads again when a turn ends.
- The thread says when a stop waits, and offers Force stop once the agent does not answer. It says when the agent retries a failed request. When the project left the branch the thread last ran on, Restore branch switches back.
- A Codex thread that a closed session left loaded can hand work to another agent again. Desk now lets Codex unload the thread, so the next session loads it with Desk's tools.
- Review says why it could not read the changes, such as a diff too large to read. It used to show no changes.
- Each client connected to the core gets its own thread rows, so what one is sent no longer changes what another is sent next.
- On the agy CLI, the model picker offers only Supervised, the one mode the CLI honours. Accept edits and Bypass used to ask anyway.
- A task one agent hands another stays with the thread that started it. A plugin thread that runs in the background no longer shows its tasks in the thread the tab moved to, and stopping the visible thread no longer stops them.
- Send now leaves a queued message in the queue while a turn runs on an agent that cannot take a message mid-turn. It used to start a second turn.
- A long queued message wraps inside its dashed box. Its text ran past the box's right edge.

## 0.0.1

- The first release of Desk, a Mac workspace for coding agents. It is a native app built in Rust with Rune. The thread, tool calls and diffs render as UI, not as a terminal.
- Desk runs Claude Code, Codex and Antigravity. Each uses the login and the plan it already has on this Mac. No API key is needed. One agent can hand a task to another, and the answer comes back to the thread.
- Tabs from several projects share one window. Each tab keeps its thread, its draft and its view pane. Messages can carry images, `@` files and `/` commands, and can steer or queue while a turn runs.
- A thread can be rewound, forked, renamed or deleted. Review shows the thread's, Git's, the branch's or the last turn's changes. Subagents and background commands each have a card.
- Plugins in `~/.desk/plugins` add sidebars, panels, cards, setups and commands. `docs/plugins.md` describes them.
- `mise run install` builds Desk.app and installs it in `/Applications`. `desk <folder>` opens a folder in the running Desk.
