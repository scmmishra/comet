import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join } from "node:path"
import { CHANNELS } from "../shared/bridge"
import type { DeskCommand } from "../shared/commands"
import { CoreProcess } from "./core-process"
import { chooseFolder, folder } from "./folders"
import { installMenu } from "./menu"

// Without a name, Electron names the app and its settings folder after the npm package.
app.setName("Desk")

// Lets an agent read and drive the page over the DevTools protocol, without screenshots.
if (process.env.DESK_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.DESK_DEBUG_PORT)

/** The folder `desk <folder>` asks to open, as `bin/desk` sets it. */
const requested = process.env.DESK_DIR ? folder(process.env.DESK_DIR) : undefined

/**
 * One Desk runs at a time: its window's tabs are saved in one file, which a second Desk would overwrite.
 * A second launch, such as `desk ~/code/repo`, hands its folder to the running Desk and quits.
 */
const firstLaunch = app.requestSingleInstanceLock({ dir: requested })
if (!firstLaunch) app.quit()

let core: CoreProcess | undefined
let window: BrowserWindow | undefined
/** Commands sent before the page loaded. The page takes them once it has. */
let pending: DeskCommand[] = requested ? [{ id: "project.open", dir: requested }] : []

/** Sends a command to the page, which owns the tabs, or keeps it until the page has loaded. */
function send(command: DeskCommand) {
  if (window && !window.webContents.isLoading()) window.webContents.send(CHANNELS.command, command)
  else pending.push(command)
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
  window.on("closed", () => (window = undefined))
  window.webContents.on("did-finish-load", () => {
    for (const command of pending) window?.webContents.send(CHANNELS.command, command)
    pending = []
  })
  // Full screen hides the window buttons, so the tab bar drops the room it keeps for them.
  const sendFullScreen = () => window?.webContents.send(CHANNELS.fullScreen, window.isFullScreen())
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
  if (dir) send({ id: "project.open", dir })
  if (!window) createWindow()
  window?.show()
  window?.focus()
})

app.whenReady().then(async () => {
  if (!firstLaunch) return
  core = await CoreProcess.start()
  ipcMain.handle(CHANNELS.core, () => core?.info)
  ipcMain.handle(CHANNELS.isFullScreen, () => window?.isFullScreen() ?? false)
  ipcMain.handle(CHANNELS.chooseFolder, () => chooseFolder(window))
  installMenu(send)
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Desk keeps running with no window, as Mac apps do. The Dock icon opens a new one.
app.on("window-all-closed", () => {})

app.on("will-quit", () => core?.stop())
