import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

contextBridge.exposeInMainWorld("desk", {
  core: () => ipcRenderer.invoke("desk:core"),
  projects: () => ipcRenderer.invoke("desk:projects"),
  openProject: (path: string) => ipcRenderer.invoke("desk:open-project", path),
  chooseProject: () => ipcRenderer.invoke("desk:choose-project"),
  onCommand(listener: (command: string) => void) {
    const handler = (_event: IpcRendererEvent, command: string) => listener(command)
    ipcRenderer.on("desk:command", handler)
    return () => ipcRenderer.off("desk:command", handler)
  },
})
