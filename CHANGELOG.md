# Changelog

All notable changes to Desk are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `app/package.json` as that release's notes.

## Unreleased

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
