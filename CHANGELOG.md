# Changelog

All notable changes to Desk are listed here. Changes go under `## Unreleased` until they ship. The release workflow publishes the section for the version in `app/package.json` as that release's notes.

## 0.1.0

- The first build of Desk as a Mac app. `mise run install` builds Desk.app and installs it in `/Applications`. Running it again while Desk is open updates Desk: it quits Desk, replaces the app and opens it again.
- Desk.app carries the core, its packages and a Bun binary, so it needs nothing from the repo or your PATH.
- The icon is a cube hovering over a slab. On macOS 26 it follows the system's light and dark appearance.
- `mise run dev` starts Desk Dev, which runs beside the installed Desk with an amber icon. It keeps its own tabs in `~/.desk/dev`, and shares settings, commands and plugins with Desk.
- Plugins in `~/.desk/plugins` add sidebars, panels, cards, setups and commands. `docs/plugins.md` describes them.
