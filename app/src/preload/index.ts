import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

contextBridge.exposeInMainWorld("desk", {
  core: () => ipcRenderer.invoke("desk:core"),
  onCommand(listener: (command: string) => void) {
    const handler = (_event: IpcRendererEvent, command: string) => listener(command)
    ipcRenderer.on("desk:command", handler)
    return () => ipcRenderer.off("desk:command", handler)
  },
})
