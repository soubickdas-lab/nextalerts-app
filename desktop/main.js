// NextAlerts desktop app: one window that opens the live dashboard. Every change made on the website is in the
// app the moment it is deployed; only the shell itself (this file) needs a new installer, and the app fetches
// that from the GitHub release by itself when the Update button is pressed.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, dialog, session, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");

const APP_URL = process.env.NEXTALERTS_URL || "https://work.nextalerts.in";
const APP_ORIGIN = new URL(APP_URL).origin;
const REPO = "soubickdas-lab/nextalerts-app";
const SMOKE = process.argv.includes("--smoke-test"); // CI: load the site, print what happened, quit

let win = null, tray = null, quitting = false, toldTray = false;
const showWindow = () => { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); };

// ------------------------------------------------------------ window state
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const max = win.isMaximized();
  const b = max ? readState().bounds || win.getNormalBounds() : win.getNormalBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), bounds: b, max })); } catch {}
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
      backgroundThrottling: false, // keep listening for notifications while the window is hidden
    },
  });
  if (st.max) win.maximize();
  win.once("ready-to-show", () => { if (!SMOKE) win.show(); });
  // closing the window only hides it: the app stays in the tray (Windows) / Dock (Mac) so notifications keep
  // coming. "Quit" in the tray or menu really closes it.
  win.on("close", (e) => {
    saveState();
    if (quitting || SMOKE) return;
    e.preventDefault();
    win.hide();
    if (process.platform === "win32" && !toldTray) { toldTray = true; tray?.displayBalloon?.({ title: "NextAlerts is still running", content: "It stays here so notifications reach you. Right-click the icon to quit." }); }
  });
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

// ------------------------------------------------------------ open at login
const autostartOn = () => app.isPackaged && app.getLoginItemSettings({ args: ["--autostart"] }).openAtLogin;
function setAutostart(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: ["--autostart"] });
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), noAutostart: !on })); } catch {}
  buildMenu();
}

// ------------------------------------------------------------ menu
function buildMenu() {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [
      { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => win?.loadURL(APP_URL) },
      { label: "Check for updates…", click: () => checkAndTell() },
      { label: "Open when the computer starts", type: "checkbox", checked: autostartOn(), click: (item) => setAutostart(item.checked) },
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
// The newest version is read from the address GitHub redirects "releases/latest" to — no API call, so no
// hourly limit when a whole office sits behind one internet connection.
async function latestVersion() {
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
    redirect: "manual", headers: { "user-agent": "nextalerts-app" }, signal: AbortSignal.timeout(20000),
  });
  const m = (res.headers.get("location") || "").match(/\/releases\/tag\/v?(\d+(?:\.\d+)*)$/);
  if (!m) throw new Error(`GitHub said ${res.status}`);
  return m[1];
}
const assetName = (v) => (process.platform === "win32" ? `NextAlerts-Setup-${v}.exe` : `NextAlerts-${v}-${process.arch === "arm64" ? "arm64" : "x64"}.dmg`);
const assetUrl = (v) => `https://github.com/${REPO}/releases/download/v${v}/${assetName(v)}`;
async function checkUpdate() {
  const current = app.getVersion();
  try {
    const version = await latestVersion();
    return { current, version, available: isNewer(version, current), url: `https://github.com/${REPO}/releases/tag/v${version}` };
  } catch (err) {
    return { current, available: false, error: String(err.message || err) };
  }
}
const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 300000 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).split("\n")[0])) : resolve(stdout)));
});
let installing = null;
async function installUpdate() {
  if (installing) return installing;
  installing = (async () => {
    const version = await latestVersion();
    if (!isNewer(version, app.getVersion())) return { ok: true, message: `Already on the latest version (${app.getVersion()}).` };
    const name = assetName(version);
    const dir = path.join(app.getPath("temp"), `nextalerts-update-${version}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    const res = await fetch(assetUrl(version), { headers: { "user-agent": "nextalerts-app" } });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1e6) throw new Error("The download was incomplete");
    fs.writeFileSync(file, bytes);
    if (process.platform === "win32") {
      // the installer replaces this app, so it has to outlive it; it reopens the app when it is done
      spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => { quitting = true; app.quit(); }, 1200);
      return { ok: true, message: `Installing ${version}… the app will close and open again.` };
    }
    // Mac: swap the app in place — no dragging. The new app is copied out of the dmg, then a small script waits
    // for this app to close, replaces the bundle where it is installed, and opens it again.
    try {
      const bundle = path.resolve(process.execPath, "..", "..", ".."); // …/NextAlerts.app
      if (!bundle.endsWith(".app") || bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/")) throw new Error("the app is not installed in a normal folder");
      fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
      const mnt = path.join(dir, "mnt");
      fs.mkdirSync(mnt, { recursive: true });
      await run("/usr/bin/hdiutil", ["attach", file, "-nobrowse", "-readonly", "-mountpoint", mnt]);
      const fresh = path.join(dir, "NextAlerts.app");
      try {
        await run("/usr/bin/ditto", [path.join(mnt, "NextAlerts.app"), fresh]);
      } finally {
        await run("/usr/bin/hdiutil", ["detach", mnt, "-force"]).catch(() => {});
      }
      await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", fresh]).catch(() => {});
      await run("/usr/bin/codesign", ["--verify", "--deep", fresh]);
      const sh = path.join(dir, "swap.sh");
      const q = (x) => "'" + x.replace(/'/g, "'\\''") + "'";
      fs.writeFileSync(sh, [
        "#!/bin/sh",
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        `rm -rf ${q(bundle + ".old")}`,
        `mv ${q(bundle)} ${q(bundle + ".old")} || exit 1`,
        `if /usr/bin/ditto ${q(fresh)} ${q(bundle)}; then rm -rf ${q(bundle + ".old")}; else rm -rf ${q(bundle)}; mv ${q(bundle + ".old")} ${q(bundle)}; fi`,
        `/usr/bin/open ${q(bundle)}`,
        "",
      ].join("\n"), { mode: 0o755 });
      spawn("/bin/sh", [sh], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => { quitting = true; app.quit(); }, 1200);
      return { ok: true, message: `Installing ${version}… the app will close and open again.` };
    } catch (err) {
      // could not swap by itself (no write access, odd location): fall back to the dmg
      await shell.openPath(file);
      return { ok: true, message: `Opened ${name} — drag NextAlerts into Applications (replace the old one), then open it again. (${String(err.message || err).slice(0, 80)})` };
    }
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
ipcMain.handle("app:focus", () => { showWindow(); });
// the red number on the icon: Windows draws the page's little badge image over the taskbar icon, the Mac Dock shows it by itself
ipcMain.handle("app:badge", (e, n, image) => {
  n = Math.max(0, Math.min(999, Number(n) || 0));
  if (process.platform === "win32") {
    if (!win) return;
    try { win.setOverlayIcon(n && image ? nativeImage.createFromDataURL(image) : null, n ? `${n} unread` : ""); } catch {}
    if (n && !win.isFocused()) win.flashFrame(true);
  } else {
    try { app.setBadgeCount(n); } catch {}
  }
});

// ------------------------------------------------------------ start
// tests run the app beside an installed one: a separate profile folder keeps the two apart
if (process.env.NEXTALERTS_PROFILE) app.setPath("userData", process.env.NEXTALERTS_PROFILE);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("before-quit", () => { quitting = true; });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("in.nextalerts.work");
    // the dashboard may show notifications, read the clipboard for paste, and record the mic; nothing else is asked for
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
      cb(isOurs(details.requestingUrl || wc.getURL()) && ["notifications", "clipboard-read", "clipboard-sanitized-write", "media", "fullscreen"].includes(permission));
    });
    // open at login (Windows: Startup, Mac: Login Items). On by default; the tray / File menu can switch it off.
    if (!SMOKE && app.isPackaged) {
      const st = app.getLoginItemSettings({ args: ["--autostart"] });
      if (!st.openAtLogin && !readState().noAutostart) app.setLoginItemSettings({ openAtLogin: true, args: ["--autostart"] });
    }
    buildMenu();
    if (process.platform === "win32" && !SMOKE) {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
      tray.setToolTip("NextAlerts");
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open NextAlerts", click: showWindow },
        { label: "Check for updates…", click: () => { showWindow(); checkAndTell(); } },
        { label: "Open when the computer starts", type: "checkbox", checked: autostartOn(), click: (item) => setAutostart(item.checked) },
        { type: "separator" },
        { label: "Quit", click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on("click", showWindow);
    }
    createWindow();
    app.on("activate", () => showWindow());
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin" && quitting) app.quit(); });
}
