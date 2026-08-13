// Preload — the ONLY bridge between the sandboxed renderer and the main process.
// The renderer has no Node access; it can only call these named, typed channels.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rd", {
  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (updates) => ipcRenderer.invoke("config:save", updates),

  // Connect / lifecycle
  connect: (opts) => ipcRenderer.invoke("runner:connect", opts),
  start: () => ipcRenderer.invoke("runner:start"),
  stop: () => ipcRenderer.invoke("runner:stop"),
  restart: () => ipcRenderer.invoke("runner:restart"),
  reconnect: () => ipcRenderer.invoke("runner:reconnect"),
  isRunning: () => ipcRenderer.invoke("runner:isRunning"),

  // Live data
  status: () => ipcRenderer.invoke("runner:status"),
  log: (n) => ipcRenderer.invoke("runner:log", n),

  // Tools / helpers
  installEssentials: () => ipcRenderer.invoke("tools:installEssentials"),
  openStatusPage: () => ipcRenderer.invoke("app:openStatusPage"),
  paths: () => ipcRenderer.invoke("app:paths"),

  // Updates
  checkUpdate: () => ipcRenderer.invoke("app:checkUpdate"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  appVersion: () => ipcRenderer.invoke("app:version"),
});
