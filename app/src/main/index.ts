import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join } from "node:path"
import { CoreProcess } from "./core-process"
import { chooseFolder, initialFolder, rememberFolder } from "./folders"
import { installMenu } from "./menu"

// Without a name, Electron names the app and its settings folder after the npm package.
app.setName("Desk")

// Lets an agent read and drive the page over the DevTools protocol, without screenshots.
if (process.env.DESK_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.DESK_DEBUG_PORT)

let core: CoreProcess | undefined
let window: BrowserWindow | undefined

/** Points the window at another folder: a new core for it, then a fresh page. */
async function openFolder(dir: string) {
  const next = await CoreProcess.start(dir)
  core?.stop()
  core = next
  rememberFolder(dir)
  window?.webContents.reload()
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#08090a",
    titleBarStyle: "hiddenInset",
    // Centres the window buttons on the 44px tab bar. macOS 26 draws them larger than before.
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
    },
  })
  window.once("ready-to-show", () => window?.show())
  // Links in the thread open in the browser, never inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url)
    return { action: "deny" }
  })
  // A link the page did not open in a new window must not replace the app.
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window?.webContents.getURL()) return
    event.preventDefault()
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url)
  })
  // In development, page warnings and errors go to the terminal that runs Desk.
  if (!app.isPackaged) {
    window.webContents.on("console-message", ({ level, message }) => {
      if (level === "warning" || level === "error") console.log(`[renderer ${level}] ${message}`)
    })
  }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, "../renderer/index.html"))
}

app.whenReady().then(async () => {
  const dir = await initialFolder()
  if (!dir) return app.quit()
  core = await CoreProcess.start(dir)
  rememberFolder(dir)
  ipcMain.handle("desk:core", () => core?.info)
  installMenu({
    openFolder: async () => {
      const chosen = await chooseFolder(window)
      if (chosen) await openFolder(chosen)
    },
  })
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => core?.stop())
