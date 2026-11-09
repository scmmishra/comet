interface Window {
  readonly desk: {
    core(): Promise<{ readonly port: number; readonly token: string }>
  }
}
