# Plugins

A plugin adds UI to Desk: a sidebar, panels, cards in the card stack, setups and palette commands. This page describes the first version, and lists what comes later.

## Goals

- Some plugins are useful in every project, such as a New Relic dashboard. Others belong to one repo, such as a support inbox. One API covers both.
- A plugin decides what it offers. The user decides where it is on.
- Nothing shows in a tab unless the user, a setup, another view or a card asks for it.
- Opening a tab, switching tabs and toggling a pane stay instant. A plugin that is not on never starts.

## Terms

- **Plugin.** A module in `~/.desk/plugins/<name>/`, starting from `index.tsx` or `index.ts`. It runs in a worker in the core.
- **Contribution.** One thing a plugin registers. It is named `<plugin>.<name>`, such as `support.inbox`.
- **Sidebar.** A view in the column beside the thread, for navigation, such as an inbox. A tab shows at most one.
- **Panel.** A view type for a tab in the view pane, such as a PR or a conversation. A panel can take parameters.
- **Panel instance.** One open panel: a panel and its parameters. Its id looks like `support.conversation?id=1001`.
- **Card.** A view in the card stack beside the thread. The Space card is built into the app and comes first. Plugin cards follow it.
- **Setup.** A starting layout for a tab: a sidebar, panels and cards to leave out.
- **Command.** A palette entry that runs plugin code for the active tab.

## Where plugins are on

Plugins live only in `~/.desk/plugins`. A repo never holds plugins, so opening a repo runs no code from it.

`~/.desk/plugins.json` turns plugins on:

```json
{
  "everywhere": ["newrelic"],
  "projects": { "~/Chatwoot/chatwoot": ["support"] }
}
```

- A project is named by its folder. A second clone or a worktree is another project.
- A plugin on in a project offers all its contributions there. A contribution has no scope of its own.
- The file is read each time a project's plugins are read. A missing file turns every plugin off. A broken file turns every plugin off and is reported.

## What shows

| Contribution | Shows when |
|---|---|
| Sidebar | A setup opens it. |
| Panel | A view or command opens it with `ctx.open`, a setup opens it, or the user opens it from the palette. |
| Card | Always, unless the tab's setup leaves it out. A card that draws nothing is left out. The Space card always shows. |
| Setup | The user opens it from the palette. It opens a new tab. |
| Command | The user runs it from the palette. |

- The palette's "Open panel…" lists only panels that need no parameters.
- Every panel instance has a close button.

## API

```ts
export default definePlugin((desk) => {
  desk.sidebar(name, { title, view })
  desk.panel(name, { title, params?, single?, view })
  desk.card(name, { title, view })
  desk.setup(name, { title, sidebar?, panels?, hideCards? })
  desk.command(name, { title, input?, run })
})
```

- The setup function passed to `definePlugin` runs once per plugin, for every tab. State made there is shared by every tab.
- Registration happens while `definePlugin` runs. A later call throws.
- `params` names what a panel needs. Parameters are strings, numbers, booleans or null.
- A panel with `single: true` has one instance per tab. Opening another replaces it in place, as the support inbox does with conversations.
- A panel's `title` is a string, or a function of its parameters.
- A command with `input` asks for text in the palette, and `run` gets it.
- `desk.env` holds the core's environment, such as an API key. `desk.toast` shows a short message.

### View context

Each view and command gets a `ctx` for its tab:

| Field | What it is |
|---|---|
| `ctx.project` | `{ path, name }` of the tab's project. |
| `ctx.$` | Bun's shell, run in the tab's folder. |
| `ctx.open(panel, params?)` | Opens a panel instance in the tab, or brings the open one to the front. The view pane opens. |
| `ctx.isOpen(panel, params?)` | Whether that instance is open in the tab. It updates as panels open and close. |
| `ctx.openThread({ key, title?, prompt? })` | Opens or resumes the tab's Claude thread for `key`. |
| `ctx.toast(message)` | Shows a short message. |

A panel's context also has `ctx.params` and `ctx.close()`.

## Who owns what

- The core owns each tab's layout: its sidebar, its open panel instances and the cards it leaves out. It saves them in `~/.desk/window.json` with the tab.
- A plugin and the app change a layout the same way, through the core. The core checks that a panel gets its parameters.
- The core runs a plugin's views and commands only in projects where the plugin is on. One lookup checks this for panels, setups and commands.
- On each change, the core draws what the layout needs and sends it whole to the app as `layout`. It tells the plugins which instances are open, for `isOpen`.
- The app owns which panel tab shows. When a panel opens, the core sends `panel.show`, and the app brings it forward.
- A restored tab reads its saved layout. It does not read its setup again.

### Messages

| From the app | Does |
|---|---|
| `layout.get` | Draws a saved tab's layout and sends it. The app asks once per tab, when the tab first shows, and again after it reconnects to the core. |
| `panel.open`, `panel.close` | Opens or closes a panel instance. |
| `setup.open` | Lays out a saved tab as a setup says. |
| `plugin.command` | Runs a command for a tab. |
| `plugin.event` | Runs a handler a plugin's node holds. |

| From the core | Carries |
|---|---|
| `layout` | A tab's layout, with each view's plugin and root node. |
| `panel.show` | The instance to bring forward. |
| `notice` | A plugin's toast. |
| `plugin.ops` | Changes to a plugin's UI tree. |
| `project` with part `plugins` | What the user can start from the palette in a project: panels that need no parameters, setups and commands. |

## Runtime

- Each plugin runs in one Bun worker in the core, shared by every tab.
- A worker starts the first time a project it is on is read. Its setup runs, and it reports what it registered.
- Each view is drawn once per tab and kept until its panel closes or its tab closes.
- UI crosses to the app as operations: `create`, `text`, `set`, `insert`, `remove`.
- `protocol` lists the UI primitives and their props once. The plugin package builds its components from that list, and the app draws each one.

## Example

`examples/plugins/support` is a support inbox on made-up conversations. It registers an inbox sidebar, a conversation panel and a setup. Picking a conversation opens its panel and its Claude thread. Link it to `~/.desk/plugins/support` and turn it on for a project.

## Later

- A switcher for sidebars, so the user can open one without a setup.
- A "+" menu in the view pane for panels, beside the new terminal button.
- Pinned panels, for a project or a setup, that every new tab opens.
- Hiding and ordering cards per project.
- Plugin settings, with a page in Settings.
- Reloading one plugin without restarting the core.
- A manifest that lists a plugin's contributions, so Desk can list them without starting the worker.
- A key per repo, such as its `origin` remote, so clones and worktrees share settings.
