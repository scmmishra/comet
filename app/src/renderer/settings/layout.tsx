import type { JSX } from "solid-js"
import { Show } from "solid-js"

/** A page's sticky title, a line on what it covers, and room for actions beside the title. */
export function SettingsHeader(props: { title: string; description: string; actions?: JSX.Element }) {
  return (
    <div class="settings-tab-header">
      <div class="flex items-start justify-between gap-4">
        <div class="flex flex-col gap-1">
          <h2 class="settings-tab-title">{props.title}</h2>
          <span class="settings-tab-description">{props.description}</span>
        </div>
        <Show when={props.actions}>{props.actions}</Show>
      </div>
    </div>
  )
}

/** A titled group of settings on a page. */
export function SettingsSection(props: { title: JSX.Element; children: JSX.Element }) {
  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{props.title}</h3>
      {props.children}
    </section>
  )
}

/** Rows on one raised surface, after OpenCode's SettingsList. */
export function SettingsList(props: { children: JSX.Element }) {
  return <div data-component="settings-list">{props.children}</div>
}

/** One setting: its name and what it does on the left, its control on the right. After OpenCode's SettingsRow. */
export function SettingsRow(props: { title: JSX.Element; description?: JSX.Element; children?: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <Show when={props.description}>
          <div data-slot="settings-row-description">{props.description}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div data-slot="settings-row-control">{props.children}</div>
      </Show>
    </div>
  )
}
