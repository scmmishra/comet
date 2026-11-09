import { app, BrowserWindow, ipcMain, shell } from "electron"
import { basename, join } from "node:path"
import { CoreProcess } from "./core-process"
import { chooseFolder, initialFolder, isFolder, recentProjects, rememberProject } from "./folders"
import { installMenu } from "./menu"

// Without a name, Electron names the app and its settings folder after the npm package.
app.setName("Desk")

// Lets an agent read and drive the page over the DevTools protocol, without screenshots.
if (process.env.DESK_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.DESK_DEBUG_PORT)

/**
 * One Desk runs at a time: its window's tabs are saved in one file, which a second Desk would overwrite.
 * A second launch, such as `desk ~/code/repo`, hands its folder to the running Desk and quits.
 */
const firstLaunch = app.requestSingleInstanceLock({ dir: process.env.DESK_DIR })
if (!firstLaunch) app.quit()

let core: CoreProcess | undefined
let window: BrowserWindow | undefined

/** Opens a tab in a folder. The page owns the tabs, so it makes the tab. */
function openInTab(dir: string) {
  rememberProject(dir)
  window?.webContents.send("desk:command", `project.open:${dir}`)
  window?.show()
  window?.focus()
}

/** Asks for a folder and records it as a recent project. */
async function chooseProject(): Promise<string | undefined> {
  const chosen = await chooseFolder(window)
  if (chosen) rememberProject(chosen)
  return chosen
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

app.on("second-instance", (_event, _argv, _cwd, data) => {
  const dir = (data as { dir?: string } | undefined)?.dir
  if (dir && isFolder(dir)) openInTab(dir)
  else window?.focus()
})

app.whenReady().then(async () => {
  if (!firstLaunch) return
  // The core serves every project. This folder is the one a window with no tabs opens on.
  const dir = await initialFolder()
  if (!dir) return app.quit()
  core = await CoreProcess.start(dir)
  rememberProject(dir)
  ipcMain.handle("desk:core", () => core?.info)
  ipcMain.handle("desk:is-full-screen", () => window?.isFullScreen() ?? false)
  ipcMain.handle("desk:projects", () => recentProjects().map((path) => ({ path, name: basename(path) })))
  // Only a folder from the recent list is taken this way. Any other folder goes through the picker.
  ipcMain.handle("desk:use-project", (_event, path: string) => recentProjects().includes(path) && rememberProject(path))
  ipcMain.handle("desk:choose-project", chooseProject)
  installMenu({ openFolder: () => void chooseProject().then((dir) => dir && openInTab(dir)) })
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => core?.stop())
