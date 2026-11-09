interface Window {
  readonly desk: {
    core(): Promise<{ readonly port: number; readonly token: string }>
    /** Folders Desk has opened, most recent first. */
    projects(): Promise<readonly { readonly path: string; readonly name: string }[]>
    /** Moves a recent project to the front of the list, as a tab takes it. */
    useProject(path: string): Promise<void>
    /** Asks for a folder and records it as a recent project. Resolves to it, or to undefined when cancelled. */
    chooseProject(): Promise<string | undefined>
    isFullScreen(): Promise<boolean>
    /** Calls back when the window enters or leaves full screen. Returns a function that stops listening. */
    onFullScreen(listener: (fullScreen: boolean) => void): () => void
    /** Commands from the app menu, such as `tab.new` or `project.open:<folder>`. Returns a function that stops listening. */
    onCommand(listener: (command: string) => void): () => void
  }
}
