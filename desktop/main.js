// NextAlerts desktop app: one window that opens the live dashboard. Every change made on the website is in the
// app the moment it is deployed; only the shell itself (this file) needs a new installer, and the app fetches
// that from the GitHub release by itself when the Update button is pressed.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, dialog, session, nativeTheme, screen } = require("electron");
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
  // a saved position is only used when it is still on a screen (a monitor that was unplugged left the window
  // off-screen, which looked like the app had vanished); otherwise the window opens centred
  let b = st.bounds || {};
  try {
    const onScreen = b.x != null && screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x + 80 < a.x + a.width && b.x + (b.width || 0) - 80 > a.x && b.y + 40 < a.y + a.height && b.y >= a.y - 20; });
    if (!onScreen) b = { width: b.width, height: b.height };
    const wa = screen.getPrimaryDisplay().workArea;
    b.width = Math.min(b.width || 1320, wa.width); b.height = Math.min(b.height || 860, wa.height);
  } catch { b = {}; }
  win = new BrowserWindow({
    width: b.width || 1320,
    height: b.height || 860,
    x: b.x,
    y: b.y,
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
      backgroundThrottling: true, // hidden window sleeps; the live socket still delivers messages (false here heated Macs)
    },
  });
  if (st.max) win.maximize();
  win.once("ready-to-show", () => { if (!SMOKE) { win.show(); win.focus(); } });
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

// ---------- quick ticks from the tray (Windows) / menu bar (Mac) ----------
// Today's uploads and tasks, ticked without opening the window. Data comes from the same signed-in session the
// window uses, so nothing extra is stored. The list refreshes when the menu is opened and after every tick.
let today = null, todayAt = 0, todayErr = "";
const api = async (p, opts = {}) => {
  const res = await session.defaultSession.fetch(APP_URL + "/api" + p, { method: opts.method || "GET", headers: opts.body ? { "content-type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || `server ${res.status}`); e.status = res.status; throw e; }
  return j;
};
async function loadToday() {
  try { today = await api("/quick/today"); todayErr = ""; }
  catch (e) { todayErr = e.status === 401 ? "Sign in to NextAlerts first" : e.status === 503 ? "The server is busy right now — try again in a little while" : "Could not load today — check the internet"; }
  todayAt = Date.now();
  paintTray();
  if (process.env.NA_TRAY_DUMP) console.log("TRAY", JSON.stringify({ err: todayErr, today }));
}
const external = () => win?.webContents.executeJavaScript("window.dispatchEvent(new Event('na-external-change'))").catch(() => {});
async function tickUpload(id) {
  const u = (today?.uploads || []).find((x) => x.id === id);
  if (!u) return;
  const body = u.per > 1 ? { track_id: u.id, day: today.day, n: u.done ? 0 : u.n + 1 } : { track_id: u.id, day: today.day, on: !u.done };
  try { await api("/tracker/tick", { method: "POST", body }); todayErr = ""; } catch (e) { todayErr = `Could not tick ${u.channel}: ${e.message}`; }
  await loadToday(); external();
}
async function tickTask(id) {
  const t = (today?.tasks || []).find((x) => x.id === id);
  if (!t) return;
  try { await api(`/todos/${t.id}`, { method: "PUT", body: { status: t.done ? "To do" : "Done" } }); todayErr = ""; } catch (e) { todayErr = `Could not update the task: ${e.message}`; }
  await loadToday(); external();
}

// ---- the today panel: a small frameless window under the menu-bar icon (Mac) / above the tray icon (Windows)
let pop = null, popH = 360, popHiddenAt = 0;
const POP_W = 320;
function makePop() {
  const mac = process.platform === "darwin";
  pop = new BrowserWindow({
    width: POP_W, height: popH, show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true, roundedCorners: true,
    transparent: mac, vibrancy: mac ? "popover" : undefined, visualEffectState: mac ? "active" : undefined,
    backgroundColor: mac ? "#00000000" : (nativeTheme.shouldUseDarkColors ? "#1c1c1f" : "#ffffff"),
    webPreferences: { preload: path.join(__dirname, "tray-preload.js"), contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  pop.loadFile(path.join(__dirname, "tray.html"));
  pop.on("blur", () => { if (process.env.NA_TRAY_SHOT) return; pop.hide(); popHiddenAt = Date.now(); });
  pop.webContents.on("console-message", (...a) => { if (process.env.NA_TRAY_SHOT) console.log("POP", a.slice(1).join(" ")); });
  pop.webContents.on("will-navigate", (e) => e.preventDefault());
  pop.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
function placePop() {
  const b = tray.getBounds();
  const disp = screen.getDisplayNearestPoint({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
  const wa = disp.workArea;
  let x = Math.round(b.x + b.width / 2 - POP_W / 2), y;
  if (process.platform === "darwin") y = Math.round(b.y + b.height + 6);
  else {
    // Windows: the taskbar can sit on any edge; open towards the screen
    const bottom = b.y > wa.y + wa.height / 2;
    y = bottom ? Math.round(wa.y + wa.height - popH - 10) : Math.round(wa.y + 10);
    if (b.x > wa.x + wa.width - 40 || b.x < wa.x) x = wa.x + wa.width - POP_W - 10; // taskbar on the side / overflow area
  }
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - POP_W - 8));
  y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - popH - 4));
  pop.setBounds({ x, y, width: POP_W, height: popH });
}
function togglePop() {
  if (!pop) makePop();
  if (pop.isVisible()) { pop.hide(); return; }
  if (Date.now() - popHiddenAt < 250) return; // the click that blurred it should not reopen it
  placePop(); pop.show(); pop.focus();
  if (Date.now() - todayAt > 20000) loadToday();
}
const trayData = () => ({ today, err: todayErr });
ipcMain.handle("tray:get", () => trayData());
ipcMain.handle("tray:refresh", () => loadToday());
ipcMain.handle("tray:tick-upload", (e, id) => tickUpload(id));
ipcMain.handle("tray:tick-task", (e, id) => tickTask(id));
ipcMain.handle("tray:open", () => { pop?.hide(); showWindow(); });
ipcMain.handle("tray:hide", () => pop?.hide());
ipcMain.handle("tray:quit", () => { quitting = true; app.quit(); });
ipcMain.handle("tray:size", (e, h) => {
  popH = Math.max(160, Math.min(560, Math.round(h)));
  if (pop && pop.isVisible()) placePop();
});

function paintTray() {
  if (!tray) return;
  const left = today ? (today.uploads || []).filter((u) => !u.done).length + (today.tasks || []).filter((t) => !t.done).length : 0;
  tray.setToolTip(left ? `NextAlerts · ${left} left for today` : "NextAlerts");
  if (process.platform === "darwin") tray.setTitle(left ? ` ${left}` : "");
  pop?.webContents.send("tray:data", trayData());
}
function startTray() {
  const img = process.platform === "darwin"
    ? (() => { const i = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png")); i.setTemplateImage(true); return i; })()
    : nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip("NextAlerts");
  tray.on("click", togglePop);
  tray.on("right-click", togglePop);
  if (process.platform === "win32") tray.on("double-click", () => { pop?.hide(); showWindow(); });
  setTimeout(loadToday, 8000);
  setInterval(loadToday, 10 * 60000);
  // test hook: open the panel and save a picture of it (NA_TRAY_SHOT=<file.png>)
  if (process.env.NA_TRAY_SHOT) setTimeout(async () => {
    if (process.env.NA_THEME) nativeTheme.themeSource = process.env.NA_THEME;
    togglePop(); await new Promise((r) => setTimeout(r, 3000)); console.log("VISIBLE", pop.isVisible());
    if (process.env.NA_TRAY_CLICK) { await pop.webContents.executeJavaScript("document.querySelector('[data-t]')?.click()"); await new Promise((r) => setTimeout(r, 3000)); }
    const img = await pop.webContents.capturePage();
    fs.writeFileSync(process.env.NA_TRAY_SHOT, img.toPNG()); console.log("SHOT", pop.getBounds()); app.exit(0);
  }, 11000);
}
// Open a YouTube / Studio page in a given Chrome profile (Chrome's own --profile-directory switch). Lets the dashboard
// open Studio in profiles that do not have the Browser Hub extension. Only youtube.com addresses, only a profile
// folder name — nothing else from the page reaches the command line.
function chromePath() {
  const c = process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"))
    : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", path.join(app.getPath("home"), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")];
  return c.find((f) => { try { return fs.existsSync(f); } catch { return false; } }) || "";
}
ipcMain.handle("app:open-chrome", (e, dir, url) => {
  dir = String(dir || ""); url = String(url || "");
  if (!/^(Default|Profile \d{1,4}|Guest Profile|System Profile|[\w .@-]{1,60})$/.test(dir) || /\.\./.test(dir)) return { ok: false, error: "bad profile" };
  if (!/^https:\/\/(studio\.youtube\.com|www\.youtube\.com|youtube\.com|m\.youtube\.com)(\/|$)/.test(url)) return { ok: false, error: "only YouTube addresses" };
  const exe = chromePath();
  if (!exe) return { ok: false, error: "Google Chrome not found" };
  try {
    spawn(exe, [`--profile-directory=${dir}`, url], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
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
    if (!SMOKE) startTray();
    createWindow();
    app.on("activate", () => showWindow());
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin" && quitting) app.quit(); });
}
