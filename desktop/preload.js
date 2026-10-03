// The only bridge between the website and the app shell: the page can ask which app version it is running in,
// whether a newer app exists, and start the update. Nothing else from Node reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nextalertsApp", {
  platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : process.platform,
  version: () => ipcRenderer.invoke("app:version"),
  checkUpdate: () => ipcRenderer.invoke("app:check-update"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  retry: () => ipcRenderer.invoke("app:retry"),
  focus: () => ipcRenderer.invoke("app:focus"),
});
