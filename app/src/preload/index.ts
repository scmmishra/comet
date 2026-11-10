import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { CHANNELS, type DeskBridge } from "../shared/bridge"

/** Listens on a channel. Returns a function that stops listening. */
function listen<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => void ipcRenderer.off(channel, handler)
}

const bridge: DeskBridge = {
  core: () => ipcRenderer.invoke(CHANNELS.core),
  chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder),
  isFullScreen: () => ipcRenderer.invoke(CHANNELS.isFullScreen),
  onFullScreen: (listener) => listen(CHANNELS.fullScreen, listener),
  onCommand: (listener) => listen(CHANNELS.command, listener),
  onNotice: (listener) => listen(CHANNELS.notice, listener),
}

contextBridge.exposeInMainWorld("desk", bridge)
