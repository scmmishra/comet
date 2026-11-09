import { FONT_SIZES, THEMES } from "@desk/protocol"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { account, updateSettings } from "../account"
import { THEME_LABELS } from "../appearance"
import { SettingsHeader, SettingsList, SettingsRow } from "./layout"

const SIZES = Array.from({ length: FONT_SIZES.max - FONT_SIZES.min + 1 }, (_, index) => FONT_SIZES.min + index)

/** The window's theme, fonts and thread text size. */
export function AppearancePage() {
  const appearance = () => account.settings.appearance
  return (
    <>
      <SettingsHeader title="Appearance" description="How Desk looks. Changes apply at once." />
      <div class="settings-tab-body">
        <SettingsList>
          <SettingsRow title="Theme" description="System follows macOS's light or dark setting.">
            <Select
              options={[...THEMES]}
              current={appearance().theme}
              value={(theme) => theme}
              label={(theme) => THEME_LABELS[theme]}
              placement="bottom-end"
              gutter={6}
              onSelect={(theme) => theme && updateSettings({ appearance: { theme } })}
            />
          </SettingsRow>
          <SettingsRow title="Font size" description="The size of thread text. Code blocks and the message box follow it.">
            <Select
              options={SIZES}
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
  const font = () => account.settings.appearance[props.field]
  return (
    <SettingsRow title={props.title} description={props.description}>
      <TextInput
        class="w-[220px]"
        value={font()}
        placeholder={props.placeholder}
        spellcheck={false}
        aria-label={props.title}
        style={{ "font-family": font() || undefined }}
        onChange={(event) => updateSettings({ appearance: { [props.field]: event.currentTarget.value } })}
      />
    </SettingsRow>
  )
}
