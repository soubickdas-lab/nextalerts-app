// The today panel under the tray / menu-bar icon: a local page with only these calls. Nothing else from Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trayApi", {
  platform: process.platform,
  get: () => ipcRenderer.invoke("tray:get"),
  refresh: () => ipcRenderer.invoke("tray:refresh"),
  tickUpload: (id) => ipcRenderer.invoke("tray:tick-upload", Number(id)),
  tickTask: (id) => ipcRenderer.invoke("tray:tick-task", Number(id)),
  open: () => ipcRenderer.invoke("tray:open"),
  quit: () => ipcRenderer.invoke("tray:quit"),
  hide: () => ipcRenderer.invoke("tray:hide"),
  size: (h) => ipcRenderer.invoke("tray:size", Number(h) || 0),
  onData: (fn) => ipcRenderer.on("tray:data", (_e, d) => fn(d)),
});
