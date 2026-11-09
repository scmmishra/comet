import type { ThemeChoice } from "@desk/protocol"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { state, updateSettings } from "../store"
import { SettingsHeader, SettingsList, SettingsRow } from "./layout"

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Auto" },
]
/** The sizes the core accepts, in px. */
const FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

/** The window's theme, fonts and thread text size. */
export function AppearancePage() {
  const appearance = () => state.settings.appearance
  return (
    <>
      <SettingsHeader title="Appearance" description="How Desk looks. Changes apply at once." />
      <div class="settings-tab-body">
        <SettingsList>
          <SettingsRow title="Theme" description="Auto follows the system's light or dark setting.">
            <Select
              options={THEMES}
              current={THEMES.find((theme) => theme.value === appearance().theme)}
              value={(theme) => theme.value}
              label={(theme) => theme.label}
              placement="bottom-end"
              gutter={6}
              onSelect={(theme) => theme && updateSettings({ appearance: { theme: theme.value } })}
            />
          </SettingsRow>
          <SettingsRow title="Font size" description="The size of thread text. Code blocks and the message box follow it.">
            <Select
              options={FONT_SIZES}
              current={appearance().fontSize}
              value={String}
              label={(size) => `${size}px`}
              placement="bottom-end"
              gutter={6}
              onSelect={(size) => size && updateSettings({ appearance: { fontSize: size } })}
            />
          </SettingsRow>
          <FontRow title="Interface font" description="The font for everything but code. Leave it empty for Geist." field="uiFont" placeholder="Geist" />
          <FontRow title="Code font" description="The font for code, diffs and terminals. Leave it empty for Geist Mono." field="codeFont" placeholder="Geist Mono" />
        </SettingsList>
      </div>
    </>
  )
}

/** A font name, saved when the field loses focus or on Enter, so typing a name does not save each letter. */
function FontRow(props: { title: string; description: string; field: "uiFont" | "codeFont"; placeholder: string }) {
  const save = (value: string) => value.trim() !== state.settings.appearance[props.field] && updateSettings({ appearance: { [props.field]: value } })
  return (
    <SettingsRow title={props.title} description={props.description}>
      <TextInput
        class="w-[220px]"
        value={state.settings.appearance[props.field]}
        placeholder={props.placeholder}
        spellcheck={false}
        aria-label={props.title}
        style={{ "font-family": state.settings.appearance[props.field] || undefined }}
        onChange={(event) => save(event.currentTarget.value)}
      />
    </SettingsRow>
  )
}
