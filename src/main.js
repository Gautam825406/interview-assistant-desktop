/**
 * Interview Assistant — Electron main process (SaaS client)
 *
 * The app is a client for the Interview Assistant SaaS backend. It holds NO
 * provider API keys — the backend (FastAPI) holds the owner's keys
 * (Fernet-encrypted) and proxies all AI calls. Users sign up / log in, and
 * the backend enforces their subscription plan.
 *
 * Window: frameless, always-on-top, discreet overlay. Transparent by
 * default (frosted-glass UI); a solid mode is available in Settings.
 * setContentProtection(true) excludes the window from normal screen
 * capture / screen-share on Windows (WDA_EXCLUDEFROMCAPTURE) and macOS.
 * That is NOT invisibility from proctoring / detection tools — see the
 * in-app privacy note. Use live help only where it is permitted.
 */
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_API_BASE = 'https://interview-assistant-api.onrender.com';

let mainWindow = null;
let checkoutWindow = null;
let tray = null;
let privateMode = true; // content protection ON by default

const userData = () => app.getPath('userData');
const sessionsFile = () => path.join(userData(), 'sessions.json');
const settingsFile = () => path.join(userData(), 'settings.json');

function defaultSettings() {
  return { apiBase: DEFAULT_API_BASE, token: '', user: null, language: 'en', autoAnswer: true, transparent: true };
}
function readSettings() {
  return { ...defaultSettings(), ...readJson(settingsFile(), {}) };
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---- Backend API (main process does the fetching, so no CORS issues
// for the file:// renderer, and the JWT never has to leave main) ----
async function apiFetch(reqPath, { method = 'GET', body = null, form = null } = {}) {
  const s = readSettings();
  const base = (s.apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const headers = {};
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  let payload;
  if (form) { payload = form; /* fetch sets the multipart boundary itself */ }
  else if (body != null) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + reqPath, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

function createWindow() {
  const s = readSettings();
  const transparent = s.transparent !== false;
  mainWindow = new BrowserWindow({
    width: 460,
    height: 700,
    minWidth: 380,
    minHeight: 500,
    frame: false,               // frameless overlay
    transparent,                // see-through window; UI is a frosted-glass panel
    alwaysOnTop: true,          // stays above Meet / Zoom
    skipTaskbar: true,          // hidden from taskbar / Alt+Tab on Windows
    resizable: true,
    show: false,
    backgroundColor: transparent ? '#00000000' : '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Exclude from screen capture / screen-share (Windows + macOS).
  // Does NOT hide the process from Activity Monitor / Task Manager,
  // and does NOT defeat proctoring software.
  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (!app.quitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function recreateWindow() {
  // Transparency can only be set at window creation, so toggling it
  // rebuilds the window. Settings (incl. token) persist in userData.
  if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
  createWindow();
}

function createTray() {
  const iconPath = path.join(__dirname, 'renderer', 'icon.png');
  tray = new Tray(fs.existsSync(iconPath) ? iconPath : undefined);
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide  (Ctrl+Shift+I)', click: () => toggleWindow() },
    { label: 'Toggle Private mode  (Ctrl+Shift+P)', click: () => togglePrivate() },
    { label: 'Toggle transparent window', click: () => { const s = readSettings(); writeJson(settingsFile(), { ...s, transparent: s.transparent === false }); recreateWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Interview Assistant');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide(); else { mainWindow.show(); mainWindow.focus(); }
}

function togglePrivate() {
  privateMode = !privateMode;
  if (mainWindow) mainWindow.setContentProtection(privateMode);
  mainWindow?.webContents.send('private-mode-changed', privateMode);
  return privateMode;
}

app.whenReady().then(() => {
  // Tray icon may not exist on first run (generated at build time) — guard it.
  try { createTray(); } catch (e) { console.warn('Tray unavailable:', e.message); }
  createWindow();

  globalShortcut.register('CommandOrControl+Shift+I', toggleWindow);
  globalShortcut.register('CommandOrControl+Shift+P', togglePrivate);
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('hotkey-minimise');
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows/Linux; quit on macOS convention is the opposite,
  // but tray-first behaviour is what this helper needs — do not quit here.
  if (process.platform === 'darwin') app.dock?.hide();
});
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---- IPC: settings (JWT + user cached here; NO provider keys anywhere) ----
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:save', (_e, s) => { writeJson(settingsFile(), { ...readSettings(), ...s }); return true; });
ipcMain.handle('app:set-transparent', (_e, transparent) => {
  writeJson(settingsFile(), { ...readSettings(), transparent: !!transparent });
  recreateWindow();
  return true;
});

// ---- IPC: auth (token lives in userData/settings.json) ----
ipcMain.handle('auth:login', async (_e, { email, password }) => {
  const r = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
  if (r.status === 200 && r.data?.token) {
    writeJson(settingsFile(), { ...readSettings(), token: r.data.token, user: r.data.user || null });
  }
  return r;
});
ipcMain.handle('auth:signup', async (_e, { name, email, password }) => {
  const r = await apiFetch('/api/auth/signup', { method: 'POST', body: { name, email, password } });
  if (r.status === 200 && r.data?.token) {
    writeJson(settingsFile(), { ...readSettings(), token: r.data.token, user: r.data.user || null });
  }
  return r;
});
ipcMain.handle('auth:logout', () => {
  writeJson(settingsFile(), { ...readSettings(), token: '', user: null });
  return true;
});

// ---- IPC: generic backend call (Bearer attached in main) ----
ipcMain.handle('api:call', (_e, reqPath, opts) => apiFetch(reqPath, opts || {}));

// ---- IPC: transcription — audio chunk -> multipart POST /api/ai/transcribe ----
ipcMain.handle('api:transcribe', async (_e, { base64, mime }) => {
  try {
    const buf = Buffer.from(base64 || '', 'base64');
    const form = new FormData();
    // The filename extension must match the audio container, or Whisper
    // rejects the file as "not a valid media file".
    const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm';
    form.append('audio', new Blob([buf], { type: mime || 'audio/webm' }), 'chunk.' + ext);
    return await apiFetch('/api/ai/transcribe', { method: 'POST', form });
  } catch (err) {
    return { status: 0, data: { error: err.message } };
  }
});

// ---- IPC: Cashfree checkout window ----
// The checkout runs in its own window (renderer/checkout.html) which loads
// the Cashfree JS SDK (prod or sandbox, per the backend's mode) and calls
// checkout() with the payment_session_id. After paying, the window verifies
// via GET /api/subscriptions/verify?order_id=... — the webhook activates
// the subscription server-side even if the user closes the window.
ipcMain.handle('checkout:open', (_e, { paymentSessionId, mode, orderId }) => {
  if (checkoutWindow) { checkoutWindow.focus(); return true; }
  checkoutWindow = new BrowserWindow({
    width: 480,
    height: 720,
    frame: true,
    title: 'Complete payment — Interview Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  checkoutWindow.loadFile(path.join(__dirname, 'renderer', 'checkout.html'), {
    query: { psid: paymentSessionId || '', mode: mode || 'SANDBOX', order_id: orderId || '' },
  });
  checkoutWindow.on('closed', () => { checkoutWindow = null; });
  return true;
});
ipcMain.handle('app:open-external', (_e, url) => { shell.openExternal(url); return true; });

// ---- IPC: sessions (local history in userData) ----
ipcMain.handle('sessions:list', () => readJson(sessionsFile(), []));
ipcMain.handle('sessions:save', (_e, session) => {
  const list = readJson(sessionsFile(), []);
  list.unshift({ ...session, id: session.id || `s_${Date.now()}`, savedAt: new Date().toISOString() });
  writeJson(sessionsFile(), list.slice(0, 200));
  return true;
});
ipcMain.handle('sessions:delete', (_e, id) => {
  writeJson(sessionsFile(), readJson(sessionsFile(), []).filter((s) => s.id !== id));
  return true;
});
ipcMain.handle('app:private-mode', () => privateMode);
ipcMain.handle('app:toggle-private', () => togglePrivate());
ipcMain.handle('app:hide', () => { mainWindow?.hide(); return true; });
ipcMain.handle('app:minimise', () => { mainWindow?.minimize(); return true; });
ipcMain.handle('app:quit', () => { app.quitting = true; app.quit(); return true; });

// ---- IPC: screen / tab sources for Meet / Zoom capture ----
ipcMain.handle('capture:sources', async () => {
  // Large thumbnails so the screenshot is sharp enough for vision/OCR.
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 1600, height: 900 } });
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

// ---- IPC: resume parsing (local, pdf-parse) ----
ipcMain.handle('resume:parse', async (_e, filePath) => {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(filePath));
    return { ok: true, text: (data.text || '').slice(0, 20000) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('resume:pick-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Resume', extensions: ['pdf', 'txt', 'md'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const fp = r.filePaths[0];
  if (fp.toLowerCase().endsWith('.pdf')) return { path: fp, ...(await (async () => {
    try { const p = require('pdf-parse'); const d = await p(fs.readFileSync(fp)); return { ok: true, text: (d.text || '').slice(0, 20000) }; }
    catch (e) { return { ok: false, error: e.message }; }
  })()) };
  return { path: fp, ok: true, text: fs.readFileSync(fp, 'utf8').slice(0, 20000) };
});
