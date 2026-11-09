import { Tabs } from "@opencode/ui/tabs"
import { For, onMount } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Icon } from "../icons"
import { closeSettings, openSettings, workspace } from "../workspace"
import { SETTINGS_PAGES } from "./pages"
import "./settings.css"

/**
 * Desk's settings, after OpenCode's settings screen: a sidebar of pages, and the chosen page beside it.
 * It shows in place of the session. Back, or Escape, returns to it.
 */
export function SettingsScreen() {
  let root!: HTMLDivElement
  onMount(() => root.focus({ preventScroll: true }))
  const page = () => SETTINGS_PAGES.find((found) => found.id === workspace.settingsPage) ?? SETTINGS_PAGES[0]!
  return (
    <div
      ref={root}
      class="settings-screen"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        event.preventDefault()
        closeSettings()
      }}
    >
      <Tabs orientation="vertical" variant="settings" value={page().id} onChange={openSettings} class="settings">
        <aside class="settings-sidebar">
          <div class="settings-nav">
            <button type="button" class="settings-back" onClick={closeSettings}>
              <Icon name="arrow-left" />
              Back to app
            </button>
            <Tabs.List class="settings-nav-groups">
              <For each={SETTINGS_PAGES}>
                {(found) => (
                  <Tabs.Trigger value={found.id}>
                    <Icon name={found.icon} />
                    {found.title}
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
          </div>
        </aside>
        <div class="settings-content">
          <div class="settings-panel">
            <Dynamic component={page().view} />
          </div>
        </div>
      </Tabs>
    </div>
  )
}
