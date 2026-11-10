import type { DeskCommand } from "./commands"

/** Where the core listens, and the token it asks for. */
export interface CoreInfo {
  readonly port: number
  readonly token: string
}

/** The IPC channels between the main process and the page. */
export const CHANNELS = {
  core: "desk:core",
  chooseFolder: "desk:choose-folder",
  isFullScreen: "desk:is-full-screen",
  fullScreen: "desk:full-screen",
  command: "desk:command",
  notice: "desk:notice",
} as const

/** What the preload script gives the page as `window.desk`. */
export interface DeskBridge {
  core(): Promise<CoreInfo>
  /** Asks for a folder. Resolves to it, or to undefined when cancelled. */
  chooseFolder(): Promise<string | undefined>
  isFullScreen(): Promise<boolean>
  /** Calls back when the window enters or leaves full screen. Returns a function that stops listening. */
  onFullScreen(listener: (fullScreen: boolean) => void): () => void
  /** Commands from the app menu. Returns a function that stops listening. */
  onCommand(listener: (command: DeskCommand) => void): () => void
  /** Short notices from the main process to show as a toast. Returns a function that stops listening. */
  onNotice(listener: (message: string) => void): () => void
}
