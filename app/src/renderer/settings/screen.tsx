import { Icon as OpenCodeIcon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { Tabs } from "@opencode/ui/tabs"
import { For, Match, onMount, Switch } from "solid-js"
import { closeSettings, openSettings, SETTINGS_PAGES, state, type SettingsPage } from "../store"
import { AppearancePage } from "./appearance"
import { McpsPage } from "./mcps"
import { ProjectsPage } from "./projects"
import { ProvidersPage } from "./providers"
import { SkillsPage } from "./skills"
import "./settings.css"

const PAGES: Record<SettingsPage, { label: string; icon: IconName }> = {
  providers: { label: "Providers", icon: "providers" },
  appearance: { label: "Appearance", icon: "appearance" },
  projects: { label: "Projects", icon: "folder" },
  mcps: { label: "MCP servers", icon: "mcp" },
  skills: { label: "Skills", icon: "post-skill" },
}

/**
 * Desk's settings, after OpenCode's settings screen: a sidebar of pages, and the chosen page beside it.
 * It shows in place of the session. Back, or Escape, returns to it.
 */
export function SettingsScreen() {
  let root!: HTMLDivElement
  onMount(() => root.focus({ preventScroll: true }))
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
      <Tabs orientation="vertical" variant="settings" value={state.settingsPage} onChange={(page) => openSettings(page as SettingsPage)} class="settings">
        <aside class="settings-sidebar">
          <div class="settings-nav">
            <button type="button" class="settings-back" onClick={closeSettings}>
              <OpenCodeIcon name="arrow-left" size="small" />
              Back to app
            </button>
            <Tabs.List class="settings-nav-groups">
              <For each={SETTINGS_PAGES}>
                {(page) => (
                  <Tabs.Trigger value={page}>
                    <OpenCodeIcon name={PAGES[page].icon} />
                    {PAGES[page].label}
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
          </div>
        </aside>
        <div class="settings-content">
          <div class="settings-panel">
            <Switch>
              <Match when={state.settingsPage === "providers"}>
                <ProvidersPage />
              </Match>
              <Match when={state.settingsPage === "appearance"}>
                <AppearancePage />
              </Match>
              <Match when={state.settingsPage === "projects"}>
                <ProjectsPage />
              </Match>
              <Match when={state.settingsPage === "mcps"}>
                <McpsPage />
              </Match>
              <Match when={state.settingsPage === "skills"}>
                <SkillsPage />
              </Match>
            </Switch>
          </div>
        </div>
      </Tabs>
    </div>
  )
}
