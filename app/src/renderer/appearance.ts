import type { ThemeChoice } from "@desk/protocol"
import { createEffect, createRoot, createSignal } from "solid-js"
import { account } from "./account"

/** What each theme is called. Auto follows macOS, as System does in macOS's own settings. */
export const THEME_LABELS: Record<ThemeChoice, string> = { dark: "Dark", light: "Light", auto: "System" }

const systemDark = matchMedia("(prefers-color-scheme: dark)")
const [prefersDark, setPrefersDark] = createSignal(systemDark.matches)
systemDark.addEventListener("change", (event) => setPrefersDark(event.matches))

/** The theme the window draws in: the setting, with Auto read from the system. */
export const colorScheme = (): "light" | "dark" => {
  const theme = account.settings.appearance.theme
  return theme === "auto" ? (prefersDark() ? "dark" : "light") : theme
}

/** The scheme the page draws in now. It changes after the page's CSS has, so colours read from CSS then are current. */
const [appliedScheme, setAppliedScheme] = createSignal<"light" | "dark">()
export { appliedScheme }

/** Desk's colour for a role, such as "panel", as the applied theme sets it. Surfaces that draw outside CSS read it. */
export const themeColor = (role: "panel" | "fg" | "accent-soft") => getComputedStyle(document.documentElement).getPropertyValue(`--color-${role}`).trim()

/** Applies the appearance settings to the page: the theme, the fonts and the thread text size. */
export function applyAppearance() {
  createRoot(() =>
    createEffect(() => {
      const root = document.documentElement
      const { uiFont, codeFont, fontSize } = account.settings.appearance
      root.dataset.colorScheme = colorScheme()
      setOrClear(root, "--desk-ui-font", uiFont)
      setOrClear(root, "--desk-code-font", codeFont)
      root.style.setProperty("--desk-text-size", `${fontSize}px`)
      setAppliedScheme(colorScheme())
    }),
  )
}

function setOrClear(root: HTMLElement, name: string, value: string) {
  if (value) root.style.setProperty(name, value)
  else root.style.removeProperty(name)
}
