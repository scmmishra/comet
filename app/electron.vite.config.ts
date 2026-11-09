import { defineConfig } from "electron-vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [solid(), tailwindcss()],
  },
})
