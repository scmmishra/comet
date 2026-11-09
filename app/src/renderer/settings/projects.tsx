import { PROJECT_COLORS, type ProjectColor, type ProjectSettings } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { Popover } from "@opencode/ui/popover"
import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, For, Show } from "solid-js"
import { core } from "../core"
import { projectName } from "../format"
import { ProjectMark, projectLabel } from "../project-mark"
import { findProjectIcons, state, updateSettings } from "../store"
import { SettingsHeader, SettingsList, SettingsRow, SettingsSection } from "./layout"

/** How each project open in a tab shows: its name, colour and icon. */
export function ProjectsPage() {
  // Each project once, in the order its first tab sits.
  const projects = createMemo(() => [...new Set(state.tabs.map((tab) => tab.project))])
  return (
    <>
      <SettingsHeader title="Projects" description="How each project open in a tab shows in tabs and menus." />
      <div class="settings-tab-body">
        <For each={projects()}>{(project) => <ProjectSection project={project} />}</For>
      </div>
    </>
  )
}

function ProjectSection(props: { project: string }) {
  const settings = (): ProjectSettings => state.settings.projects[props.project] ?? {}
  // A project's settings replace what it had, so each change sends them whole.
  const save = (change: ProjectSettings) => updateSettings({ project: { dir: props.project, settings: { ...settings(), ...change } } })
  return (
    <SettingsSection
      title={
        <span class="flex items-center gap-2">
          <ProjectMark project={props.project} class="size-[18px]" />
          {projectLabel(props.project)}
          <span class="truncate font-normal text-fg-3">{props.project.replace(/^\/Users\/[^/]+/, "~")}</span>
        </span>
      }
    >
      <SettingsList>
        <SettingsRow title="Name" description="Leave it empty to use the folder's name.">
          <TextInput
            class="w-[220px]"
            value={settings().name ?? ""}
            placeholder={projectName(props.project)}
            aria-label="Project name"
            onChange={(event) => save({ name: event.currentTarget.value })}
          />
        </SettingsRow>
        <SettingsRow title="Color" description="The colour of the project's letter, when it has no icon.">
          <div class="flex gap-1.5" role="radiogroup" aria-label="Project color">
            <For each={PROJECT_COLORS}>{(color) => <ColorSwatch project={props.project} color={color} selected={settings().color === color} onPick={() => save({ color })} />}</For>
          </div>
        </SettingsRow>
        <SettingsRow title="Icon" description="An image from the project, such as its logo or favicon.">
          <IconPicker project={props.project} current={settings().icon} onPick={(icon) => save({ icon })} />
        </SettingsRow>
      </SettingsList>
    </SettingsSection>
  )
}

/** One colour as the project's letter would draw in it. */
function ColorSwatch(props: { project: string; color: ProjectColor; selected: boolean; onPick: () => void }) {
  return (
    <Tooltip value={props.color.charAt(0).toUpperCase() + props.color.slice(1)} placement="top">
      <button
        type="button"
        role="radio"
        aria-checked={props.selected}
        aria-label={props.color}
        class="rounded-md p-0.5 outline-offset-1"
        classList={{ "outline outline-2 outline-accent": props.selected }}
        onClick={props.onPick}
      >
        <ProjectAvatar fallback={projectLabel(props.project)} variant={props.color} class="size-6" />
      </button>
    </Tooltip>
  )
}

/** A grid of the project's logo-like images. It asks the core for them each time it opens, so new files show. */
function IconPicker(props: { project: string; current?: string; onPick: (icon: string | undefined) => void }) {
  const [open, setOpen] = createSignal(false)
  const files = () => state.projects[props.project]?.iconFiles
  const pick = (icon: string | undefined) => {
    props.onPick(icon)
    setOpen(false)
  }
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        if (next) findProjectIcons(props.project)
        setOpen(next)
      }}
      placement="bottom-end"
      gutter={6}
      class="w-[340px] max-w-none"
      triggerAs={Button}
      triggerProps={{ variant: "outline" }}
      trigger={
        <span class="flex items-center gap-2">
          <ProjectMark project={props.project} />
          {props.current ? "Change" : "Choose"}
        </span>
      }
    >
      <Show when={files()} fallback={<div class="px-1 py-2 text-fg-3">Looking for images…</div>}>
        {(found) => (
          <div class="grid gap-2">
            <Show when={found().length > 0} fallback={<div class="px-1 py-2 text-fg-3">No logo, icon or favicon images in this project.</div>}>
              <div class="grid max-h-[300px] grid-cols-6 gap-1.5 overflow-y-auto">
                <For each={found()}>
                  {(file) => (
                    <Tooltip value={file} placement="top">
                      <button
                        type="button"
                        class="grid size-11 place-items-center rounded-lg bg-raised hover:bg-hover"
                        classList={{ "outline outline-2 outline-accent": file === props.current }}
                        aria-label={file}
                        onClick={() => pick(file)}
                      >
                        <img src={core.iconUrl(props.project, file)} alt="" class="size-7 object-contain" />
                      </button>
                    </Tooltip>
                  )}
                </For>
              </div>
            </Show>
            <Show when={props.current}>
              <Button variant="ghost" class="w-fit" onClick={() => pick(undefined)}>
                No icon
              </Button>
            </Show>
          </div>
        )}
      </Show>
    </Popover>
  )
}
