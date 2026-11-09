import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("desk", {
  core: () => ipcRenderer.invoke("desk:core"),
})
