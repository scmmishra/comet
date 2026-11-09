import { createEffect, createRoot, createSignal } from "solid-js"
import { state } from "./store"

const systemDark = matchMedia("(prefers-color-scheme: dark)")
const [prefersDark, setPrefersDark] = createSignal(systemDark.matches)
systemDark.addEventListener("change", (event) => setPrefersDark(event.matches))

/** The theme the window draws in: the setting, with Auto read from the system. */
export const colorScheme = (): "light" | "dark" => {
  const theme = state.settings.appearance.theme
  return theme === "auto" ? (prefersDark() ? "dark" : "light") : theme
}

/** Desk's colour for a role, such as "panel", as the active theme sets it. Surfaces that draw outside CSS read it. */
export const themeColor = (role: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${role}`).trim()

/** Applies the appearance settings to the page: the theme, the fonts and the thread text size. */
export function applyAppearance() {
  createRoot(() =>
    createEffect(() => {
      const root = document.documentElement
      const { uiFont, codeFont, fontSize } = state.settings.appearance
      root.dataset.colorScheme = colorScheme()
      setOrClear(root, "--desk-ui-font", uiFont)
      setOrClear(root, "--desk-code-font", codeFont)
      root.style.setProperty("--desk-text-size", `${fontSize}px`)
    }),
  )
}

function setOrClear(root: HTMLElement, name: string, value: string) {
  if (value) root.style.setProperty(name, value)
  else root.style.removeProperty(name)
}
