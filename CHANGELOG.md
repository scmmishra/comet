# Changelog

All notable changes to Desk are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `app/package.json` as that release's notes.

## Unreleased

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
