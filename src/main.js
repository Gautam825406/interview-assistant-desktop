/**
 * Interview Assistant — Electron main process
 *
 * Frameless, always-on-top, discreet overlay window.
 * setContentProtection(true) excludes the window from normal screen
 * capture / screen-share on Windows (WDA_EXCLUDEFROMCAPTURE) and macOS.
 * That is NOT invisibility from proctoring / detection tools — see README
 * and the in-app privacy note. Use live help only where it is permitted.
 */
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let privateMode = true; // content protection ON by default

const userData = () => app.getPath('userData');
const sessionsFile = () => path.join(userData(), 'sessions.json');
const settingsFile = () => path.join(userData(), 'settings.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 360,
    minHeight: 480,
    frame: false,               // frameless overlay
    transparent: false,
    alwaysOnTop: true,          // stays above Meet / Zoom
    skipTaskbar: true,          // hidden from taskbar / Alt+Tab on Windows
    resizable: true,
    show: false,
    backgroundColor: '#0f172a',
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

function createTray() {
  tray = new Tray(path.join(__dirname, 'renderer', 'icon.png').length ? path.join(__dirname, 'renderer', 'icon.png') : undefined);
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide  (Ctrl+Shift+I)', click: () => toggleWindow() },
    { label: 'Toggle Private mode  (Ctrl+Shift+P)', click: () => togglePrivate() },
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

// ---- IPC: settings (Groq key stored locally in userData, never in the repo) ----
ipcMain.handle('settings:get', () => readJson(settingsFile(), { groqKey: '', model: 'openai/gpt-oss-120b', language: 'en', autoAnswer: true }));
ipcMain.handle('settings:save', (_e, s) => { writeJson(settingsFile(), s); return true; });

// ---- IPC: sessions (JSON in userData) ----
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
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
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

// ---- IPC: Groq chat (key comes from Settings, never hard-coded) ----
ipcMain.handle('groq:chat', async (_e, { key, model, messages }) => {
  if (!key) return { ok: false, error: 'No Groq API key set. Add it in Settings, or use Demo Mode.' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: model || 'openai/gpt-oss-120b', messages, temperature: 0.4, max_tokens: 1200 }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message || `Groq error ${res.status}` };
    return { ok: true, text: data.choices?.[0]?.message?.content || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---- IPC: Groq Whisper transcription (audio blob -> base64 from renderer) ----
ipcMain.handle('groq:transcribe', async (_e, { key, base64, mime }) => {
  if (!key) return { ok: false, error: 'No Groq API key set.' };
  try {
    const buf = Buffer.from(base64, 'base64');
    const form = new FormData();
    // The filename extension must match the audio container, or Whisper
    // rejects the file as "not a valid media file".
    const ext = (mime || '').includes('mp4') ? 'mp4' : 'webm';
    form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'chunk.' + ext);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message || `Groq error ${res.status}` };
    return { ok: true, text: data.text || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
