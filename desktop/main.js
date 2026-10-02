// NextAlerts desktop app: one window that opens the live dashboard. Every change made on the website is in the
// app the moment it is deployed; only the shell itself (this file) needs a new installer, and the app fetches
// that from the GitHub release by itself when the Update button is pressed.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const APP_URL = process.env.NEXTALERTS_URL || "https://work.nextalerts.in";
const APP_ORIGIN = new URL(APP_URL).origin;
const REPO = "soubickdas-lab/nextalerts-app";
const SMOKE = process.argv.includes("--smoke-test"); // CI: load the site, print what happened, quit

let win = null;

// ------------------------------------------------------------ window state
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const max = win.isMaximized();
  const b = max ? readState().bounds || win.getNormalBounds() : win.getNormalBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ bounds: b, max })); } catch {}
}

const isOurs = (url) => { try { return new URL(url).origin === APP_ORIGIN; } catch { return false; } };

function createWindow() {
  const st = readState();
  win = new BrowserWindow({
    width: st.bounds?.width || 1320,
    height: st.bounds?.height || 860,
    x: st.bounds?.x,
    y: st.bounds?.y,
    minWidth: 380,
    minHeight: 560,
    title: "NextAlerts",
    icon: path.join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0c1a" : "#eceef6",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (st.max) win.maximize();
  win.once("ready-to-show", () => { if (!SMOKE) win.show(); });
  win.on("close", saveState);
  win.on("closed", () => { win = null; });

  const wc = win.webContents;
  // links to other sites open in the normal browser; the app only ever shows the dashboard
  wc.setWindowOpenHandler(({ url }) => {
    if (isOurs(url) || url.startsWith("blob:") || url === "about:blank") return { action: "allow" };
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (isOurs(url) || url.startsWith("file:")) return;
    e.preventDefault();
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
  });
  // no internet / site down: a small page that keeps trying
  wc.on("did-fail-load", (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (a newer navigation took over)
    if (SMOKE) { console.log(`SMOKE FAIL ${code} ${desc}`); app.exit(1); return; }
    win.loadFile(path.join(__dirname, "offline.html"));
  });
  wc.on("page-title-updated", (e, title) => { e.preventDefault(); win.setTitle(title && title !== "NextAlerts" ? `${title.replace(/ · NextAlerts$/, "")} — NextAlerts` : "NextAlerts"); });
  if (SMOKE) {
    wc.once("did-finish-load", async () => {
      const info = await wc.executeJavaScript("({ title: document.title, app: !!document.getElementById('app'), bridge: typeof window.nextalertsApp, url: location.origin })").catch((x) => ({ error: String(x) }));
      console.log("SMOKE " + JSON.stringify(info));
      app.exit(info.app && info.bridge === "object" ? 0 : 1);
    });
  }
  win.loadURL(APP_URL);
}

// ------------------------------------------------------------ menu
function buildMenu() {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [
      { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => win?.loadURL(APP_URL) },
      { label: "Check for updates…", click: () => checkAndTell() },
      { type: "separator" },
      mac ? { role: "close" } : { role: "quit" },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win?.webContents.reload() },
      { label: "Reload (clear cache)", accelerator: "CmdOrCtrl+Shift+R", click: () => win?.webContents.reloadIgnoringCache() },
      { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      { label: "Back", accelerator: mac ? "Cmd+[" : "Alt+Left", click: () => win?.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: "Forward", accelerator: mac ? "Cmd+]" : "Alt+Right", click: () => win?.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
    ] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------ updates (GitHub release → installer)
function isNewer(remote, local) {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(remote), parse(local)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "nextalerts-app" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return res.json();
}
function assetFor(release) {
  const want = process.platform === "win32" ? /^NextAlerts-Setup-.*\.exe$/
    : new RegExp(`^NextAlerts-.*-${process.arch === "arm64" ? "arm64" : "x64"}\\.dmg$`);
  return (release.assets || []).find((a) => want.test(a.name));
}
async function checkUpdate() {
  const current = app.getVersion();
  try {
    const release = await latestRelease();
    const version = String(release.tag_name || "").replace(/^v/, "");
    return { current, version, available: isNewer(version, current) && !!assetFor(release), url: release.html_url };
  } catch (err) {
    return { current, available: false, error: String(err.message || err) };
  }
}
let installing = null;
async function installUpdate() {
  if (installing) return installing;
  installing = (async () => {
    const release = await latestRelease();
    const version = String(release.tag_name || "").replace(/^v/, "");
    if (!isNewer(version, app.getVersion())) return { ok: true, message: `Already on the latest version (${app.getVersion()}).` };
    const asset = assetFor(release);
    if (!asset) throw new Error(`Release ${version} has no download for this computer`);
    const dir = path.join(app.getPath("temp"), `nextalerts-update-${version}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, asset.name);
    const res = await fetch(asset.browser_download_url, { headers: { "user-agent": "nextalerts-app" } });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    if (process.platform === "win32") {
      // the installer replaces this app, so it has to outlive it; it reopens the app when it is done
      spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => app.quit(), 1200);
      return { ok: true, message: `Installing ${version}… the app will close and open again.` };
    }
    await shell.openPath(file);
    return { ok: true, message: `Opened ${asset.name} — drag NextAlerts into Applications (replace the old one), then open it again.` };
  })().finally(() => { installing = null; });
  return installing;
}
async function checkAndTell() {
  const r = await checkUpdate();
  if (r.error) return dialog.showMessageBox(win, { type: "warning", message: "Could not check for updates", detail: r.error });
  if (!r.available) return dialog.showMessageBox(win, { type: "info", message: "NextAlerts is up to date", detail: `Version ${r.current}` });
  const { response } = await dialog.showMessageBox(win, { type: "info", message: `Version ${r.version} is available`, detail: `You have ${r.current}.`, buttons: ["Update now", "Later"], defaultId: 0, cancelId: 1 });
  if (response === 0) {
    try { const out = await installUpdate(); if (process.platform !== "win32") dialog.showMessageBox(win, { type: "info", message: "Update downloaded", detail: out.message }); }
    catch (err) { dialog.showMessageBox(win, { type: "error", message: "Update failed", detail: String(err.message || err) }); }
  }
}

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:check-update", () => checkUpdate());
ipcMain.handle("app:install-update", async () => { try { return await installUpdate(); } catch (err) { return { ok: false, message: String(err.message || err) }; } });
ipcMain.handle("app:retry", () => { win?.loadURL(APP_URL); });

// ------------------------------------------------------------ start
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("in.nextalerts.work");
    // the dashboard may show notifications, read the clipboard for paste, and record the mic; nothing else is asked for
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
      cb(isOurs(details.requestingUrl || wc.getURL()) && ["notifications", "clipboard-read", "clipboard-sanitized-write", "media", "fullscreen"].includes(permission));
    });
    buildMenu();
    createWindow();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
