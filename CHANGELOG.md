# Changelog

All notable changes to Desk are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `app/package.json` as that release's notes.

## Unreleased

- Each message you sent has a pencil and a fork beside it, after T3 Code. The pencil rewinds the thread to before that message, after you confirm: Claude forgets it and everything after, and the message goes back in the message box to change and send again. You can also restore the files Claude edited since. The fork opens a copy of the thread, through that message's reply, in a new tab.
- A menu beside the session's title renames the session, forks it into a new tab, copies its ID, or deletes it after you confirm. A rename runs no turn, so Claude keeps working, and the thread list and `claude --resume` show the new name. Deleting stops a running turn, removes the thread from this Mac, and leaves the tab empty to start again.
- A plugin finds the tools on your shell's PATH, such as a CLI in ~/.local/bin. Plugins ran with the PATH Desk started with, so the Chatwoot inbox showed "command not found: chatwoot" in Desk opened from the Dock.
- An error toast shows its cause in full, under a one-line summary, such as why a plugin could not start. The toast held the whole error on one cut-off line, above an empty box.
- Settings open as a card that slides up over the tab. The tab stays behind it, pushed back and dimmed, so going back shows it at once.
- A plugin's list items can show an icon from the catalog or an image the plugin ships, such as a logo, and can open a link in the browser.
- A plugin's view knows which of the plugin's threads its tab shows, through `ctx.thread()`. A card can show what belongs to the open conversation, and follows the tab as it moves to another.
- Plugins can keep their views up to date. `desk.onTurnEnd` tells a plugin when a turn ends in a thread it opened, so it can read again what Claude may have changed. A view's `ctx.visible()` says whether the view is on screen, so it can refresh when it shows and poll only while it does.
- Desk is now a native app, built in Rust with Rune, in place of Electron. It talks to the same core, so tabs, threads, settings and plugins carry over. It is about half the size, at 207 MB. `desk <folder>` opens a folder in the running Desk through a `desk://` link.
- Desk opened from the Dock or Finder finds your tools, such as gh, cargo or your editor, including those your .zshrc adds. Claude's commands ran with macOS's short default PATH, so a command like `gh` failed with "command not found" though it worked in a terminal. Desk reads your shell's environment once and keeps it, so later starts do not wait for your shell.
- The Space card's folder, branch and changes sit evenly. An extra gap stood between the folder and the branch.
- A turn that switches off a branch no longer lists that branch's earlier work as its changes, in the thread or in Review. Asking Claude to go back to main, pull and start a new branch listed every file the old branch had changed.
- A Skill step in a thread names the skill, such as "chatwoot-cli". It showed the tool's raw input, `{"skill":"chatwoot-cli"}`.
- Picking a conversation in a plugin's sidebar starts its thread again. A conversation without a thread yet got its tab title but never sent the plugin's prompt, so the tab stayed on "Pick something in the sidebar to open its thread."
- On a new tab's start screen, the list that / and @ open shows below the message box. It was cut off above it.
- Scrolled up in a thread, a "Scroll to end" button shows above the message box, after T3 Code.
- A thread with two or more of your messages gets T3 Code's minimap in its left margin: a mark per message, 8px apart, darker while its turn is on screen. Hovering grows the nearby marks and shows your message with the start of Claude's answer. A click jumps to it, and the previous and next buttons, or the arrow keys, step between turns. In a narrow window it shows on hover.
- Settings › Providers shows the Claude Code version and whether a newer one is out on your update channel, after T3 Code. Claude Code updates itself only while it runs, so the page checks when it opens. Update runs Claude Code's own updater, for its native install.
- Desk runs the Claude Code installed on your Mac, as T3 Code does, instead of a copy bundled with the Agent SDK. Desk.app drops from about 755 MB to 448 MB, and Claude Code updates itself as it always does. Desk finds `claude` on your login shell's PATH, and `DESK_CLAUDE` points it at another. Without Claude Code installed, sending a message says so.
- Each tab keeps the message you are writing when you switch away, and its text also outlives a restart. Images you added stay until Desk quits.
- A file named in a reply opens even when it is outside the project, such as a report Claude wrote to a temporary folder. Folders and missing files still do not open.
- Drag a tab to move it in the bar. The order is saved, and ⌘1–⌘9 follow it. A press that does not move still selects the tab.
- Commands Claude leaves running in the background show in a row above the message box, after T3 Code: "Running" or "Waiting" and what runs, how long it has run, and Stop. "Waiting" means the turn has ended and Claude picks up again when the command finishes. Subagents keep their own card.
- A turn that switches branches, resets or rebases no longer lists every file that differs between the two branches as its changes. Its summary is left out. A turn that commits, pulls or merges still lists what it changed.
- ⌘⇧T reopens the tab closed last, as in a browser, in its old place and with its thread. Desk keeps the last 10 closed tabs, also after a restart. A reopened tab comes back without its terminals, which ended when it closed.
- A file named in a reply reads as part of the sentence, after T3 Code: its icon and name in the reply's own size, in the accent colour, on the line's baseline. It was a small grey box that sat off the line.
- Escape stops Claude only on a second press within 1.5 seconds. The first press shows "Press Esc again to stop Claude.", so a stray Escape no longer cuts a turn short. The Stop button still stops it at once.
- When a background task Claude started finishes, Claude Code starts a turn on its own. Desk now shows that turn under a quiet line with the task's summary, and marks the tab as working. Before, its steps joined the turn before it, which folded that turn's answer out of sight.
- A subagent or another Claude session that sends Claude a message also starts a turn of Claude's own, after T3 Code. Desk opens it with "A subagent reported back." or "Another Claude session sent a message.". Before, the turn joined the one before it and folded its answers away. A restored thread showed the whole report as a message from you.
- A slash command sent while Claude works, such as /rename, waits in the queue instead of steering. Steering it cut the running turn short. Send now still sends it at once.
- The Subagents card and a newly queued message rise in, and an image added to the message box pops in, so each one shows it arrived. Switching tabs shows them at once, without motion.
- A toast with one line of text, such as the ⌘Q warning, lines its text up with its close button. The text sat a line lower.
- ⌘Q quits only on a second press within two seconds. The first press shows "Press ⌘Q again to quit Desk.", so a slip no longer stops every running turn. Quit from the menu bar or the Dock still quits at once.
- Switching a plugin's conversation, such as in the Chatwoot inbox, no longer stops Claude's turn in the one you left. The turn goes on out of sight. Coming back shows it where it is, still running or done.
- A plugin opening a panel, such as the Chatwoot inbox on each conversation, no longer reopens a view pane you closed. The panel comes to the front for when you open the pane. In a tab where you have not opened or closed the pane yet, the panel still opens it.
- A long word in your message, such as an ID or a URL, wraps inside its bubble. It ran past the bubble's edge.
- ⌘K › Open setup lists the setups of every project with plugins on, not only the active project's. Each opens in its own project, which the row names.
- Typing / at the start of a message lists commands, after T3 Code. /model opens the model picker, and /clear starts a fresh session in the tab. Then come Claude Code's own commands, such as /compact and /context, and your skills and custom commands. Picking one puts it in the message box. A command's own output, such as /context's table, shows in the thread.
- A queued message reads in full in its dashed box, with its images at the top, and Send now, Edit and Remove sit under it, as in T3 Code.
- The thread stays scrolled to its newest line when anything changes its size, such as a new step or the queue above the message box. It followed only a reply's text before.
- A command step names the program it runs, after T3 Code: "Ran python3", not the whole command. Setup such as `cd` and `export` is skipped. Opening the step shows the command in full above its output. Every step label stays on one line, so a long command no longer spills over the rows below it.
- A single line break in a reply now shows as one, as it does in Claude Code. Lines in a quote or a list of "•" items ran together into one paragraph.
- Inline code such as `/api` or `~/code/desk` no longer shows as a file chip. A file chip needs a file extension or a line number.
- A finished turn lists the files it changed under its answer, after T3 Code: "2 changed files" with the line counts, then each file. A file opens in your editor, and the latest turn's "Open diff" opens Review on its changes. Desk saves the summaries, so a resumed thread shows them too. A turn's summary also counts edits you made while it ran.
- A turn that was stopped, such as by Desk quitting mid-turn, shows as "You stopped after…" when the thread is resumed. It showed a "[Request interrupted by user]" message as if you had typed it.
- Review can show four sets of changes, after OpenCode: the thread's changes, Git changes (uncommitted work), Branch changes (since the branch left the default branch) and Last turn changes. Each tab keeps its choice. Diffs show unified or split, and Desk keeps that choice for every tab. The Review header stays in place while the files scroll.
- You can send a message while Claude works. By default it steers the running turn: Claude takes it in at once, and it shows marked "Steered". Settings › Providers › Follow-ups can make Enter queue it instead, and ⌘Enter or ⌘-click does the other for one message. Queued messages wait above the message box, with Send now, Edit and Remove. When the turn ends, the next one starts its own turn. A stop or an error pauses the queue until you resume it, and the queue survives a restart.
- Subagents show in a card at the top of the card stack while they run. Each row shows the agent's task, its status and how long it has run. Click one to see, beside the card, what Claude asked it, its one-line status and each step it has taken. The card leaves once the turn and its subagents are done.
- A running turn reads like T3 Code's. It opens with "Working for 12 s", then shows only Claude's latest step, such as "Ran npm test", with its latest thought above. Click the step to see every step. Thoughts and tool calls between two replies form one group, summarised like "Read 3 files and ran 2 commands".
- A finished turn folds everything before its answer, file edits included, into "Worked for 1 min 3 s", or "You stopped after 12 s" if you stopped it. Each step opens to its output, its diff or the thought in full.
- Typing `@` in the message box lists the project's files, best match first. Arrow keys move through the list, and Enter or Tab puts `@path` in the message. Claude reads the file it names.
- Messages can carry images. Paste one, drop one on the message box, or pick one with the + button. Claude reads PNG, JPEG, GIF and WebP images up to 5 MB. A thread you resume shows the images you sent.
- Each tab keeps its own view pane open or closed. Opening it in one tab no longer opens it in every tab. A new tab starts with it closed.
- In light mode, the active tab is a white tile with an outline, so it stands apart from the others.
- New tabs start in Auto permission mode. Settings › Providers has a Default permissions setting. A model without Auto mode starts Supervised instead.

## 0.1.0

- The first build of Desk as a Mac app. `mise run install` builds Desk.app and installs it in `/Applications`. Running it again while Desk is open updates Desk: it quits Desk, replaces the app and opens it again.
- Desk.app carries the core, its packages and a Bun binary, so it needs nothing from the repo or your PATH.
- The icon is a cube hovering over a slab. On macOS 26 it follows the system's light and dark appearance.
- `mise run dev` starts Desk Dev, which runs beside the installed Desk with an amber icon. It keeps its own tabs in `~/.desk/dev`, and shares settings, commands and plugins with Desk.
- Plugins in `~/.desk/plugins` add sidebars, panels, cards, setups and commands. `docs/plugins.md` describes them.
