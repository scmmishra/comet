interface Window {
  readonly desk: {
    core(): Promise<{ readonly port: number; readonly token: string }>
    /** Folders Desk has opened, most recent first. */
    projects(): Promise<readonly { readonly path: string; readonly name: string }[]>
    /** Switches the window to a recent project. The page reloads. */
    openProject(path: string): Promise<void>
    /** Asks for a folder, then switches the window to it. */
    chooseProject(): Promise<void>
    isFullScreen(): Promise<boolean>
    /** Calls back when the window enters or leaves full screen. Returns a function that stops listening. */
    onFullScreen(listener: (fullScreen: boolean) => void): () => void
    /** Commands from the app menu, such as `tab.new`. Returns a function that stops listening. */
    onCommand(listener: (command: string) => void): () => void
  }
}
