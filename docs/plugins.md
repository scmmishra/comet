# Plugins

A plugin adds UI to Comet: a sidebar, panels, cards in the card stack, setups and palette commands. This page describes the first version, and lists what comes later.

## Goals

- Some plugins are useful in every project, such as a New Relic dashboard. Others belong to one repo, such as a support inbox. One API covers both.
- A plugin decides what it offers. The user decides where it is on.
- Nothing shows in a tab unless the user, a setup, another view or a card asks for it.
- Opening a tab, switching tabs and toggling a pane stay instant. A plugin that is not on never starts.

## Terms

- **Plugin.** A module in `~/.comet/plugins/<name>/`, starting from `index.tsx` or `index.ts`. It runs in a worker in the core.
- **Contribution.** One thing a plugin registers. It is named `<plugin>.<name>`, such as `support.inbox`.
- **Sidebar.** A view in the column beside the thread, for navigation, such as an inbox. A tab shows at most one.
- **Panel.** A view type for a tab in the view pane, such as a PR or a conversation. A panel can take parameters.
- **Panel instance.** One open panel: a panel and its parameters. Its id looks like `support.conversation?id=1001`.
- **Card.** A view in the card stack beside the thread. The Space card is built into the app and comes first. Plugin cards follow it.
- **Setup.** A starting layout for a tab: a sidebar, panels and cards to leave out.
- **Command.** A palette entry that runs plugin code for the active tab.

## Where plugins are on

Plugins live only in `~/.comet/plugins`. A repo never holds plugins, so opening a repo runs no code from it.

`~/.comet/plugins.json` turns plugins on:

```json
{
  "everywhere": ["newrelic"],
  "projects": { "~/Chatwoot/chatwoot": ["support"] }
}
```

- A project is named by its folder. A second clone or a worktree is another project.
- A plugin's name is its folder's name: lowercase letters, digits, `-` and `_`. A name with a dot cannot be told apart from a full id, so it is refused.
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
export default definePlugin((comet) => {
  comet.sidebar(name, { title, view })
  comet.panel(name, { title, params?, single?, view })
  comet.card(name, { title, view })
  comet.setup(name, { title, sidebar?, panels?, hideCards? })
  comet.command(name, { title, input?, run })
  comet.onTurnEnd(({ key, tabId, outcome }) => { … })
})
```

- A setup names its sidebar, panels and hidden cards by full id, such as `support.inbox`, so it can name another plugin's views. A view of a plugin that is off is left out. A name without its plugin is refused.
- The setup function passed to `definePlugin` runs once per plugin, for every tab. State made there is shared by every tab.
- Registration happens while the setup function runs. A later call throws. A name is used once in a plugin, across all kinds.
- `params` names what a panel needs. Parameters are strings, numbers, booleans or null.
- A panel with `single: true` has one instance per tab. Opening another replaces it in place, as the support inbox does with conversations.
- A panel's `title` is a string, or a function of its parameters.
- A command with `input` asks for text in the palette, and `run` gets it.
- `comet.onTurnEnd` runs a handler each time a turn ends in a thread the plugin opened with `ctx.openThread`. `key` is the key the plugin passed. `outcome` is `done`, `error` or `interrupted`. A plugin can register more than one handler, during setup only. Turns in other threads, such as a tab's own thread, never reach the plugin.
- A turn can end while a background task it started still runs. The handler runs when the turn ends, not when the task ends.
- `comet.env` holds the core's environment, such as an API key. `comet.toast` shows a short message.

### View context

Each view and command gets a `ctx` for its tab:

| Field | What it is |
|---|---|
| `ctx.project` | `{ path, name }` of the tab's project. |
| `ctx.$` | Bun's shell, run in the tab's folder. |
| `ctx.open(panel, params?)` | Opens a panel instance in the tab, or brings the open one to the front. The view pane opens. |
| `ctx.isOpen(panel, params?)` | Whether that instance is open in the tab. It updates as panels open and close. |
| `ctx.openThread({ key, title?, prompt? })` | Opens or resumes the tab's thread for `key`, on the tab's agent. Keys belong to the plugin, so two plugins never share a thread. |
| `ctx.toast(message)` | Shows a short message. |

A view's context also has `ctx.visible()`. It is true while the view is on screen: its tab is the active tab and Comet's window has focus. A panel must also be the panel in front, with the view pane open. It updates as that changes, so an effect can start work when the view shows and stop it when the view hides:

```tsx
createEffect(() => {
  if (!ctx.visible()) return
  const timer = setInterval(refresh, 60_000)
  onCleanup(() => clearInterval(timer))
})
```

A view's context also has `ctx.thread()`. It is the key of the plugin's thread the tab shows, as the plugin passed it to `ctx.openThread`. It is undefined while the tab shows its own thread or another plugin's. It updates as the tab moves between threads. A card about the open conversation reads it to know which conversation to show:

```tsx
comet.card("conversation", {
  title: "Conversation",
  view: (ctx) => <Show when={conversationOf(ctx.thread())}>{(id) => <Text>#{id()}</Text>}</Show>,
})
```

A list's `Item` can lead with an icon and open a link. `icon` names an icon from the OpenCode catalog, and `IconName` lists them. `image` draws an image file in its place, such as a logo. A plugin imports the file, and the import gives its path. `href` opens a URL in the browser when the item is pressed:

```tsx
import logo from "./logo.svg"

<Item title="Open in Chatwoot" image={logo} href={url} />
<Item title="Docs" icon="link" href={docs} />
```

A panel's context also has `ctx.params` and `ctx.close()`. A command's context has no `visible()` or `thread()`, since a command draws nothing.

## Who owns what

- The core owns each tab's layout: its sidebar, its open panel instances and the cards it leaves out. It saves them in `window.json` with the tab.
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
| `window.focus` | Says Comet's window gained or lost focus. With `tabs.save`, it decides which views are on screen. |

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
- Each view is drawn once per tab and kept while the tab shows it. On every layout change the core tells each plugin the full set of its views a tab shows, and the plugin draws what it lacks and disposes the rest.
- A sidebar or panel that cannot be drawn is closed. A card that cannot be drawn is left out of the tab. The user is told once.
- A plugin that fails to start, or stops, is reported once and stays off until the plugins reload. Its views leave every tab.
- Reload plugins, in the palette, stops every plugin and lays out every tab again. Each plugin starts again from its files, so an edit takes effect without restarting Comet. A plugin loses what it held in memory.
- The core works out which views are on screen when the tabs, a layout or the window's focus change. It tells each plugin only of its own views, and only when they change.
- The core tells a plugin which of its threads a tab shows, with each `show` and each time the tab moves to another thread.
- The core tells a plugin when a turn ends in one of its threads, even when the plugin moved the tab to another thread while the turn ran.
- UI crosses to the app as operations: `create`, `text`, `set`, `insert`, `remove`.
- `protocol` lists the UI primitives and their props once. The plugin package builds its components from that list, and the app draws each one.

## Example

`examples/plugins/support` is a support inbox on made-up conversations. It registers an inbox sidebar, a conversation panel and a setup. Picking a conversation opens its panel and its thread. Link it to `~/.comet/plugins/support` and turn it on for a project.

## Later

- A switcher for sidebars, so the user can open one without a setup.
- A "+" menu in the view pane for panels, beside the new terminal button.
- Pinned panels, for a project or a setup, that every new tab opens.
- Hiding and ordering cards per project.
- Plugin settings, with a page in Settings.
- Reloading a plugin when its files change, without the palette.
- A manifest that lists a plugin's contributions, so Comet can list them without starting the worker.
- A key per repo, such as its `origin` remote, so clones and worktrees share settings.
