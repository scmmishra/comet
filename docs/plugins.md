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

## Manifest

A plugin to share has a `package.json` with a `comet` field. A plugin folder made by hand needs none.

```json
{
  "name": "comet-plugin-reviews",
  "version": "1.0.0",
  "description": "Pull requests that wait for your review",
  "comet": { "name": "reviews", "title": "PR Reviews", "api": "^0.2.0" }
}
```

- `name` is the plugin's name. It names the plugin's folder and starts its contributions' ids, so it must not change between versions.
- `title` is what Settings and the CLI call it.
- `api` is the range of Comet's plugin API the plugin works with. The API's version is `@comet/plugin`'s. It is not a peer dependency, because `@comet/plugin` is not on npm.
- A plugin whose manifest names another plugin, or needs an API this Comet lacks, does not start. The user is told why.

### Settings

A manifest can list what the user sets for the plugin, such as a repository:

```json
"comet": {
  "name": "reviews",
  "api": "^0.2.0",
  "settings": [
    { "key": "repo", "title": "Repository", "type": "string", "required": true, "description": "owner/name on GitHub." },
    { "key": "base", "title": "Base branch", "type": "string", "default": "develop" },
    { "key": "drafts", "title": "Show drafts", "type": "boolean", "default": false },
    { "key": "sort", "title": "Sort", "type": "select", "options": ["updated", "created"] }
  ]
}
```

- `type` is `string` (one line), `text` (several lines), `boolean` or `select`, which takes `options`.
- `required` marks a setting the plugin cannot work without. Settings and `comet plugin list` say the plugin needs setup until it has a value. The plugin still starts.
- Values live in `~/.comet/plugin-settings/<plugin>.json`, apart from the plugin, so an update, a removal or a reinstall keeps them. The core checks each value against the manifest as it is saved. A value the manifest no longer allows falls back to the default.
- Settings are for everyday values. A secret, such as an API key, does not belong in them yet: they are saved as plain text.

## Installing

Comet installs a shared plugin with Bun, so a source can be an npm name, `github:owner/repo`, a git URL, a tarball or a folder.

- Installed packages live in `~/.comet/packages`, with its own `package.json` and lockfile. Each installed plugin's folder in `~/.comet/plugins` links to its package, so Comet finds every plugin the same way.
- A linked plugin's folder links to a folder elsewhere, such as one its author works in. Edits there apply on the next reload.
- Any other folder in `~/.comet/plugins` was made by hand. Comet never changes or removes it.
- Installing runs no package scripts. It does not turn the plugin on anywhere. The user does that.
- A package with no manifest, no `api` range, an API this Comet lacks, or a name already taken is not kept.
- An update takes the newest version the source allows: within the saved range for an npm package, the newest commit for a git source, and the folder as it is now for a folder. If an updated plugin changed its name or needs an API this Comet lacks, every package goes back to what it was. A folder has no earlier version, so that one stays as it is.
- Removing a plugin turns it off everywhere. A linked folder stays where it is.
- A running Comet reloads its plugins when an entry in `~/.comet/plugins` comes or goes, or the packages' lockfile changes.
- Bun may install a folder's files as hard links. Use a link, not an install, for a plugin you are editing.

### From Settings

Settings → Plugins lists every plugin in `~/.comet/plugins`: its title, version and source, and why it cannot run if it cannot. It installs from a source the user types. Each plugin shows its settings and where it runs: everywhere, or some projects. For some projects, it lists the projects Settings → Projects lists, each with a switch. A worktree counts as its repo. An installed or linked plugin has Update and Remove. A plugin missing a required setting says it needs setup. Update shows only when there is something newer to take, and names it. The page shows the plugins at once, then checks each installed plugin and shows any update when the check is done: the newest version within its saved range for a package on a registry, the newest commit for a git source, the folder's version for a folder. A check holds for 10 minutes. Text saves on Enter, several lines on ⌘Enter, and a switch or a select as it changes.

A page can offer a link to install its plugin:

```
comet://plugin/install?source=github%3Asomeone%2Fcomet-plugin-reviews
```

Any web page can open that link, so it only fills in the source and shows a word of caution. Nothing is fetched until the user presses Install.

### From the terminal

`comet plugin` manages plugins. It works on the files in `~/.comet` and never starts Comet. A running Comet sees the change and reloads its plugins.

```sh
comet plugin add github:someone/comet-plugin-reviews   # or an npm name, a git URL, a tarball or a folder
comet plugin on reviews                                 # in this folder's project
comet plugin on reviews --everywhere
comet plugin off reviews --project ~/code/web
comet plugin update                                     # every installed plugin, or those named
comet plugin list
comet plugin link .                                     # a plugin you work on
comet plugin set reviews                                # list its settings
comet plugin set reviews repo chatwoot/chatwoot         # set one, or clear it with no value
comet plugin remove reviews                             # keeps its settings; --purge removes them too
```

In a terminal, `add` asks for each of the plugin's settings, and Enter keeps what it shows. Ctrl-C skips the rest of the questions: the plugin is installed by then. `--no-input` skips them all, and a script or a pipe gets none. `list` names the required settings a plugin still lacks.

A command names a plugin by its name, such as `reviews`, or by the package it was installed as. A name that matches none lists the plugins there are. An option a command does not take is refused.

`on` and `off` name the folder the command runs in, as `comet .` opens it.

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
  comet.settings.get(key)
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
- `comet.env` holds the core's environment. `comet.toast` shows a short message.
- `comet.settings.get(key)` reads a setting the manifest lists, as the user set it or else its default. It works while setup runs. It is reactive, so a view or an effect that reads it runs again when the user changes it, without a reload.

### View context

Each view and command gets a `ctx` for its tab:

| Field | What it is |
|---|---|
| `ctx.project` | `{ path, name }` of the tab's project. |
| `ctx.$` | Bun's shell, run in the tab's folder. |
| `ctx.open(panel, params?)` | Opens a panel instance in the tab, or brings the open one to the front. The view pane opens. |
| `ctx.isOpen(panel, params?)` | Whether that instance is open in the tab. It updates as panels open and close. |
| `ctx.openThread({ key, title?, prompt? })` | Opens or resumes the tab's thread for `key`, on the tab's agent. Keys belong to the plugin, so two plugins never share a thread. |
| `ctx.run(prompt, { agent?, model?, effort?, schema?, signal? })` | Runs a prompt on an agent and resolves with its final reply. No thread shows the run. |
| `ctx.toast(message)` | Shows a short message. |

`ctx.run` runs a prompt in the tab's folder, in a session no thread shows or lists. It adds nothing to the tab's thread. It resolves with the agent's final reply as text.

- `agent` names the agent to run on, such as `"claude"` or `"codex"`. Without it, the run takes the tab's agent, model, effort and fast mode.
- `model` names one of the agent's models, by its value or its name, such as `"sonnet"`. It needs `agent`, since each agent names its models its own way. Without it, the run takes the agent's default model.
- `effort` names one of the model's effort levels, such as `"low"`.
- A plugin can let the user choose these in its settings: a `select` for the agent, and text for the model.
- `schema` is a JSON schema the reply follows. The run then resolves with the parsed JSON, not text. Claude Code and Codex take a schema, and a run with one on Antigravity is refused. Codex follows OpenAI's strict rules: every object needs `"additionalProperties": false`, and lists all its properties in `required`. Claude Code takes either.
- Comet refuses an agent, model or effort it does not have, and says which it has.

- The run is in Supervised mode, so the agent asks before it edits a file or runs a command that may change something. No thread shows its requests, so Comet declines each one. The agent may still read files and run commands it treats as read-only, such as `git diff`, without asking.
- It rejects when the run fails or ends without an answer, when `signal` aborts, and when the tab closes. A reload of the plugins ends its runs, and their promises never settle.
- Each run uses the user's agent plan. Start one when the user asks for it, such as from a button, not when a view shows.
- It needs the plugin API 0.2.1, so a plugin that calls it declares `"api": "^0.2.1"`.

```tsx
const GUIDE = {
  type: "object",
  additionalProperties: false,
  required: ["title", "stops"],
  properties: { title: { type: "string" }, stops: { type: "array", items: { type: "string" } } },
}
const [guide, setGuide] = createSignal<{ title: string; stops: string[] }>()
const generate = () =>
  ctx
    .run<{ title: string; stops: string[] }>(`Write a review guide for this diff:\n\n${diff}`, { agent: "claude", model: "sonnet", schema: GUIDE })
    .then(setGuide, (error) => ctx.toast(error.message))
<Button label="Generate guide" onClick={generate} />
```

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

`Markdown` draws images from local files, named by absolute path: `![Before](/path/to/before.png)`. The app fetches nothing from the network, so a plugin downloads an image first, as the PR review plugin does with a description's screenshots. Any other image draws as its alt text.

`Diff` draws a unified diff, as `git diff` writes it, with the diff view Review uses. It fills the space it is given, so it suits a panel of its own. Its files fold, and it follows Review's choice of unified or split. A new `patch` resets the folds. Past 8 files, every file starts folded, as in Review.

```tsx
<Diff patch={patch} />
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
| `plugins.get` | Reads the plugins in `~/.comet/plugins`, for Settings. |
| `plugin.add`, `plugin.remove` | Installs a plugin from a source, or removes one Comet installed or linked. |
| `plugins.update` | Updates installed plugins, those named or else all. |
| `plugin.toggle` | Turns a plugin on or off in a project, or everywhere. |

| From the core | Carries |
|---|---|
| `layout` | A tab's layout, with each view's plugin and root node. |
| `panel.show` | The instance to bring forward. |
| `notice` | A plugin's toast. |
| `plugin.ops` | Changes to a plugin's UI tree. |
| `project` with part `plugins` | What the user can start from the palette in a project: panels that need no parameters, setups and commands. |
| `plugins` | Every plugin in `~/.comet/plugins`, with its manifest, its source and where it is on. It follows each change Settings asks for, after a `notice` or an `error`. |

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
