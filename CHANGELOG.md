# Changelog

All notable changes to Comet are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `native/Cargo.toml` as that release's notes.

## Unreleased

- Comet has a third colour theme, Dracula. Its dark flavour takes Dracula Classic's colours, and its light flavour takes Alucard Classic's, both from the Dracula spec. Both sit on darker, cooler surfaces than the spec's.
- Comet closes a Claude Code process that has sat idle for 20 minutes, which frees hundreds of megabytes per tab. The tab and its thread stay. The next message resumes the same conversation, with its model, effort, mode and the approvals you gave for the session. A turn, a waiting request or background work keeps the process up. Before, every open tab kept its process for as long as the tab was open.
- A message sent while Claude Code worked goes back to the queue when Claude Code exits or you Force stop the turn before Claude Code reads it. The queue pauses, as after a Stop or an error, so you can send, edit or drop it. Before, it stayed marked as waiting and was lost.
- Antigravity runs Comet's own tools, such as handing a task to another agent, without asking, in every mode. Before, it asked before each call.
- A thread whose cut text ended inside an emoji shows again. Comet cuts long tool output, summaries and terminal output between whole characters. Before, half an emoji made the app drop the message, and a restored Claude thread could open empty.
- An Antigravity turn fails with an error when Antigravity does not answer within 90 seconds as it starts, and Comet ends Antigravity's process. Stop also ends a turn whose agent is still starting. Before, the turn stayed busy, and only Force stop ended it.
- An Antigravity turn that an HTTP error stopped, such as a 502 from Google, shows the error's message. Before, it showed only that an error stopped the turn.
- An Antigravity turn stays open while a command Antigravity left running in the background still runs, and Stop ends that command. A reply Antigravity starts by itself, once such a command ends, shows as its own turn, and a permission it asks for there waits for you. Before, the tab showed idle and that reply was never finished.
- A task handed to Codex or Claude passes on why a hook stopped its turn, along with its answer. Before, the agent that asked got the answer alone.
- Codex in Full access runs a command it deems dangerous, such as `rm -rf`, without asking. Before, it asked first. It still asks before network access that Codex's network settings do not allow.
- Comet runs on a newer Rune. It fixes a crash on macOS 26, a window left black after a GPU hang, and input method and dead-key bugs. A pointer move that changes nothing no longer redraws, and long replies lay out links and text faster. The Window menu gains Zoom and Bring All to Front, and the Edit menu gains Start Dictation and Emoji & Symbols.
- A plugin's sidebar and the view pane resize. Drag the edge between two panes. One width serves every tab, and Comet keeps it across restarts. The sidebar drags from 136 to 640 points. The session keeps at least 400 points beside the view pane, and the view pane keeps at least 320.
- Thread search matches a thread's branch, and the pull request of that branch: its number, its title and its link. A pasted link to one of the pull request's tabs, such as Files, matches too. A row that matches only through one of these says which, such as "Branch: feat/inbox-search". Comet asks GitHub through `gh` for the pull requests, and skips the repo's default branch.
- A search from the palette's root finds threads in every recent project, not only the active one. It shows at most 100 threads. ⌘⇧O still searches one project.

## 0.2.0

- Settings → Projects lists recent projects and any project with a saved name, colour or icon, as well as those open in tabs. A worktree's tab lists its repo. Before, it listed only the projects open in tabs.
- Settings → Plugins lists the same projects as Settings → Projects to turn a plugin on in. A worktree shows as its repo. Before, it listed only the projects open in tabs, and a worktree tab as its own project.
- Settings → Plugins shows Update only when a plugin has a newer version or commit to take, and names it. A plugin from npm shows its package as its source. Before, it showed its version range.
- Settings → Plugins sets where a plugin runs with one choice, Everywhere or Some projects, and lists projects one line each, with their mark. Before, each project took a tall row of its own beside an Everywhere switch.
- `comet plugin` takes a plugin's package name as well as its name, and says which plugins there are when a name matches none. It says when a source is installed already, and when a package is not on npm. It refuses an option a command does not take.
- `comet plugin remove --purge` removes a plugin's settings too. Without it, `remove` says where the settings stay.
- Ctrl-C during `comet plugin add`'s questions skips the rest and says the plugin is installed. Before, it ended the command with no word.
- Comet installs the `comet` command into `~/.local/bin` when it starts, so a Comet from a release has it too. Comet.app carries it, so it updates with the app. A `comet` that is already there stays.
- Settings → Plugins shows each plugin's settings and saves them, and marks a plugin that needs setup.
- When a plugin's source folder is gone, the error names the plugin and says to remove it. Before, every install failed with Bun's error about a missing folder.
- `comet plugin add` asks for a plugin's settings in a terminal, and `comet plugin set` lists and sets them.
- Installing a plugin from a folder reached through a link, such as one in /tmp, no longer breaks the next install.
- A plugin can list settings in its manifest and read them with `comet.settings.get`. A change reaches the running plugin without a reload. The plugin API is now 0.2.0, so a plugin built for 0.1.0 must allow 0.2.0.
- A plugin's Markdown draws images from local files. Before, every image drew as a broken image and its alt text.
- `comet` with no folder opens the folder it runs in. `comet "<prompt>"` opens a new tab there and sends the prompt on the default agent and model.
- Settings has a Plugins page. It installs, updates and removes plugins, and turns each on everywhere or per project. A `comet://plugin/install?source=…` link opens it with the source filled in, and installs nothing until you press Install.
- `comet plugin` installs plugins from npm, git, a tarball or a folder, and updates, links and removes them. It turns a plugin on in a project or everywhere. A running Comet picks up the change without a reload.
- A plugin can carry a manifest, the `comet` field of its `package.json`, with its name, title and the plugin API versions it works with. Comet does not start a plugin that needs an API it lacks.
- Plugins can draw a diff with `Diff`, which takes a patch and draws it with the diff view Review uses.
- A long file name in Review's file header shortens with an ellipsis. Before, it ran over the status and the line counts.
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
