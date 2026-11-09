import { app, BrowserWindow, ipcMain, shell } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import type { CoreReady } from "@desk/protocol"
import { installMenu } from "./menu"

export interface CoreInfo {
  readonly port: number
  readonly token: string
}

const CORE_START_TIMEOUT_MS = 10_000

// Lets an agent read and drive the page over the DevTools protocol, without screenshots.
if (process.env.DESK_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.DESK_DEBUG_PORT)

let core: ChildProcess | undefined

/**
 * Starts the Bun core and waits for the line that says where it listens. In development the core
 * runs from source next to the app. Packaging the core is not built yet.
 */
function startCore(): Promise<CoreInfo> {
  const token = randomBytes(24).toString("hex")
  const repoRoot = resolve(app.getAppPath(), "..")
  const child = spawn(process.env.DESK_BUN ?? "bun", ["core/src/main.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DESK_TOKEN: token, DESK_DIR: process.env.DESK_DIR ?? repoRoot },
    stdio: ["pipe", "pipe", "inherit"],
  })
  core = child
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("The core did not start in time.")), CORE_START_TIMEOUT_MS)
    child.once("exit", (code) => reject(new Error(`The core exited with code ${code}.`)))
    const lines = createInterface({ input: child.stdout! })
    lines.once("line", (line) => {
      clearTimeout(timer)
      const ready = JSON.parse(line) as CoreReady
      resolvePromise({ port: ready.port, token })
    })
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#0c0c0e",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
    },
  })
  window.once("ready-to-show", () => window.show())
  // Links in the thread open in the browser, never inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url)
    return { action: "deny" }
  })
  // A link the page did not open in a new window must not replace the app.
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) return
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
  const info = await startCore()
  ipcMain.handle("desk:core", () => info)
  installMenu()
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// Closing the core's stdin tells it the app is gone. The kill is a fallback for a core that hangs.
app.on("will-quit", () => {
  core?.stdin?.end()
  setTimeout(() => core?.kill(), 1000).unref()
})
