# Changelog

All notable changes to Desk are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `native/Cargo.toml` as that release's notes.

## Unreleased

- Desk runs Antigravity as Google's `agy` CLI, in place of Google's ACP server. It installs the newest CLI from Google's release channel. Settings shows its version and offers Update when Google publishes a newer one. An Antigravity that Desk installed before needs one Install in Settings. You stay signed in.
- Antigravity offers Supervised, Auto-accept edits and Auto, as the CLI has them. It has no Full access.
- When Claude Code retries a failed API request and the retry works, the retry notice goes as soon as the new reply starts. It used to stay while Claude wrote a long tool input, such as a file to write.
- When Codex retries a request with no limit, such as while it waits for the network, the retry notice counts on from the last attempt. It used to keep showing the last attempt with its old limit, such as 3/5.
- A Codex turn fails when Codex says nothing for 10 minutes after it retries a request, with Codex's last error. Desk asks Codex to stop the turn. The tab used to stay busy until you pressed Stop and then Force stop.
- When Claude Code replaces a reply, the replaced reply and its tool calls leave the thread. Claude Code replaces a reply that the model refused once another model answers, and a reply whose tool call it could not read once the model answers again. A line in the thread says when another model answered.
- A message you steer into a Claude turn says "Waiting to steer" until Claude takes it in. Claude holds it while a tool runs in the foreground, and the message used to read as delivered.
- A Claude tool call that Stop cuts off shows as stopped, not failed.
- Closing an Antigravity tab ends Antigravity's server even when the server ignores the request to quit. Desk kills it after 2 seconds. It used to keep running.
- A paragraph no longer ends on one short word. Desk wraps text as OpenCode does, so the last line takes a word from the line above.
- Search in the command palette and in the `/` command list ignores accents and full-width letters. "cafe" finds "Café", and "ｃａｆｅ" finds "cafe".
- A middle click on a tab closes it, as its close button does.
- When the Antigravity install cannot reach Google, the error says so in plain words and says that nothing was installed. It used to show the network library's message, such as "getaddrinfo ENOTFOUND". A download that gets no data for 60 seconds now fails. It used to wait forever.
- In a terminal, Option works as the Alt key on a Mac. Option+B sends Esc B to the shell. It used to type "∫". Option no longer types characters such as "∫" or "@" in a terminal.
- The session header has a button for the project's MCP servers and skills, beside the context ring. It lists those of the tab's agent, Claude Code or Codex. A server turns on or off from its row. A skill opens its SKILL.md in the view pane. Settings no longer has MCP servers and Skills pages.
- Desk reads Codex's MCP servers and skills. Desk turns on or off only the servers that ~/.codex/config.toml sets, since Codex lets a client write only that file. A server a project sets shows as starting with a thread, since Codex starts it only there.
- An MCP server that Codex could not start shows as a warning in the thread, with Codex's reason. It warns once until the server starts. This covers Desk's own server, which lets Codex hand work to another agent.
- Desk shows its tabs sooner at launch. The core starts beside the window, not after its first frame.
- The core starts faster. It loads Babel only to build a plugin, and reuses a plugin's last build while none of its files changed.
- Git runs faster on a Mac. Desk runs the git binary that `git` points to, not Apple's /usr/bin/git, which looks up Xcode's tools on every run. A thread's first message, Review and the Space card wait less on Git.
- A thread's first message and Review run fewer git commands one after another.
- Desk quits sooner. It used to check every 20 ms whether the core had exited. Now it learns the moment the core exits.
- When a task one agent hands another fails, the agent that asked gets the task's last report as well as the error.
- A thread's first message no longer waits on a slow repo. Desk waits up to 5 seconds for the checkpoint the thread's changes are measured from, then sends without one.
- When Git fails while Desk records what a turn changed, Desk says so. The turn used to show no changes, with no reason.
- A turn Claude Code starts after a background task finishes opens with the task's summary again, and the tab shows Claude working until it ends. The turn used to join the one before it, and the tab looked idle.
- A Claude session whose stream ends mid-turn ends the turn with an error. The tab used to stay busy, and the next message went nowhere.
- A subagent's result no longer starts with the list of tools Claude Code adds for the model.
- Claude Code's notices and warnings show in the thread, such as a hook that stopped the turn. The summary a Stop hook leaves after every turn stays hidden.
- A plugin that Claude Code could not load shows as a warning in the thread, with the reason. It does not repeat on every turn.
- A Claude reply that a steered message cuts short says so under it.
- A terminal draws its screen as one element, and draws again only the rows that changed. A screen reader reads a terminal row by row and follows its cursor. Wide characters in the light theme draw in the text colour. They used to draw nearly white.
- In the command palette, the highlighted row's text no longer moves a pixel as the arrows move the highlight. After Escape leaves a nested list, the arrows and Escape work again.
- An image that Codex generates shows in the thread as a step with its prompt. Its output says where Codex saved the image, or why Codex could not make it. Desk does not show the image itself yet.
- The command palette's highlight follows the pointer. The rows under the palette no longer light up on hover.
- A Markdown file opens in the view pane as a rendered preview. A switch in its header shows its source. A file opened at a line opens on its source, with the line marked.
- In Search files, Enter pressed before the search for the new query answers opens that query's top file. It used to open the top file of the query before.
- ⌘P or ⌘⇧O while the command palette is open switches it to files or threads. They used to close it.
- Desk runs on a newer Rune. Rows, toasts and cards that the core brings now appear at once, without their entrance animation. An animation still plays when your own input causes the change. Hover groups now light while keyboard focus is inside them, so the actions they reveal show when Tab reaches them.
- Desk runs on a newer Rune. It lays out text faster. A launch reuses the glyphs the last launch drew, even when that window sat idle. Colour emoji draw their gradients.
- While a popover is open, the rows under it no longer light up as the pointer passes over it. This covers the header chip's cards, the model picker, the usage popover, a subagent's detail and the project icon picker.
- Desk runs on a newer Rune. The window goes the moment you quit, and the core stops after it. In the composer, a Japanese input method underlines each clause, and committed text can be converted again. Escape during a drag that selects thread text ends the drag.
- A Codex turn asks for the reasoning summary that Codex's config sets, else `auto`. It used to ask for `detailed` on every turn, which replaced the config's choice and which some providers, such as Amazon Bedrock, refuse.
- The Background card shows a multi-line command on one line, by its first line. The note that the agent picks up again wraps instead of running past the card.
- A dragged tab follows the pointer, and the tabs it passes slide aside. On release it slides into its place. The new order is saved once, on release.
- Review and turn summaries read every changed file right: a path with a tab, a quote or a backslash, a file that changed type, and a file past the size limit. Edits to files marked assume-unchanged or skip-worktree now show.
- Projects that share a repo, as folders or worktrees, no longer delete each other's checkpoints at start, and a plugin thread's checkpoints are kept while no tab shows it.
- The Space card counts changes as Review does: the project's folder only, new files with their lines, and staged files before the first commit. It reads again when a turn ends.
- The thread says when a stop waits, and offers Force stop once the agent does not answer. It says when the agent retries a failed request. When the project left the branch the thread last ran on, Restore branch switches back.
- A Codex thread that a closed session left loaded can hand work to another agent again. Desk now lets Codex unload the thread, so the next session loads it with Desk's tools.
- Review says why it could not read the changes, such as a diff too large to read. It used to show no changes.
- Each client connected to the core gets its own thread rows, so what one is sent no longer changes what another is sent next.
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
