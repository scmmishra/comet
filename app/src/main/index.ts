import { app, BrowserWindow, ipcMain, shell } from "electron"
import { basename, join } from "node:path"
import { CoreProcess } from "./core-process"
import { chooseFolder, initialFolder, recentProjects, rememberProject } from "./folders"
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
  rememberProject(dir)
  window?.webContents.reload()
}

async function chooseAndOpenFolder() {
  const chosen = await chooseFolder(window)
  if (chosen) await openFolder(chosen)
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
  // Full screen hides the window buttons, so the tab bar drops the room it keeps for them.
  const sendFullScreen = () => window?.webContents.send("desk:full-screen", window.isFullScreen())
  window.on("enter-full-screen", sendFullScreen)
  window.on("leave-full-screen", sendFullScreen)
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
  rememberProject(dir)
  ipcMain.handle("desk:core", () => core?.info)
  ipcMain.handle("desk:is-full-screen", () => window?.isFullScreen() ?? false)
  ipcMain.handle("desk:projects", () => recentProjects().map((path) => ({ path, name: basename(path) })))
  // Only a folder from the recent list opens this way. Any other folder goes through the picker.
  ipcMain.handle("desk:open-project", (_event, path: string) => (recentProjects().includes(path) ? openFolder(path) : undefined))
  ipcMain.handle("desk:choose-project", chooseAndOpenFolder)
  installMenu({ openFolder: chooseAndOpenFolder })
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => core?.stop())
