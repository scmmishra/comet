interface Window {
  readonly desk: {
    core(): Promise<{ readonly port: number; readonly token: string }>
    /** Commands from the app menu, such as `tab.new`. Returns a function that stops listening. */
    onCommand(listener: (command: string) => void): () => void
  }
}
