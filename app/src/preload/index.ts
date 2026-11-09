import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

contextBridge.exposeInMainWorld("desk", {
  core: () => ipcRenderer.invoke("desk:core"),
  projects: () => ipcRenderer.invoke("desk:projects"),
  useProject: (path: string) => ipcRenderer.invoke("desk:use-project", path),
  chooseProject: () => ipcRenderer.invoke("desk:choose-project"),
  isFullScreen: () => ipcRenderer.invoke("desk:is-full-screen"),
  onFullScreen(listener: (fullScreen: boolean) => void) {
    const handler = (_event: IpcRendererEvent, fullScreen: boolean) => listener(fullScreen)
    ipcRenderer.on("desk:full-screen", handler)
    return () => ipcRenderer.off("desk:full-screen", handler)
  },
  onCommand(listener: (command: string) => void) {
    const handler = (_event: IpcRendererEvent, command: string) => listener(command)
    ipcRenderer.on("desk:command", handler)
    return () => ipcRenderer.off("desk:command", handler)
  },
})
