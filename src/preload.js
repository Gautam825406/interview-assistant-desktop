const { contextBridge, ipcRenderer } = require('electron');

// SaaS client bridge. No provider keys pass through here — the backend
// holds the owner's keys and proxies all AI calls. The renderer talks to
// the backend only via main (Bearer token attached in main).
contextBridge.exposeInMainWorld('api', {
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (s) => ipcRenderer.invoke('settings:save', s),
  setTransparent: (v) => ipcRenderer.invoke('app:set-transparent', v),
  authLogin: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  authSignup: (name, email, password, phone) => ipcRenderer.invoke('auth:signup', { name, email, password, phone }),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  apiCall: (path, opts) => ipcRenderer.invoke('api:call', path, opts || {}),
  transcribe: (base64, mime) => ipcRenderer.invoke('api:transcribe', { base64, mime }),
  openCheckout: (args) => ipcRenderer.invoke('checkout:open', args),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  sessionsList: () => ipcRenderer.invoke('sessions:list'),
  sessionsSave: (s) => ipcRenderer.invoke('sessions:save', s),
  sessionsDelete: (id) => ipcRenderer.invoke('sessions:delete', id),
  privateMode: () => ipcRenderer.invoke('app:private-mode'),
  togglePrivate: () => ipcRenderer.invoke('app:toggle-private'),
  hide: () => ipcRenderer.invoke('app:hide'),
  minimise: () => ipcRenderer.invoke('app:minimise'),
  quit: () => ipcRenderer.invoke('app:quit'),
  liveOpen: () => ipcRenderer.invoke('live:open'),
  liveClose: () => ipcRenderer.invoke('live:close'),
  liveHide: () => ipcRenderer.invoke('live:hide'),
  liveScreenshot: () => ipcRenderer.invoke('live:screenshot'),
  liveGetAnswer: () => ipcRenderer.invoke('live:get-answer'),
  liveEnd: () => ipcRenderer.invoke('live:end'),
  liveUpdate: (payload) => ipcRenderer.send('live:update', payload),
  onLiveUpdate: (cb) => ipcRenderer.on('live:update', (_e, payload) => cb(payload)),
  onLiveCommand: (cb) => ipcRenderer.on('live:command', (_e, cmd) => cb(cmd)),
  captureSources: () => ipcRenderer.invoke('capture:sources'),
  pickResume: () => ipcRenderer.invoke('resume:pick-file'),
  onPrivateMode: (cb) => ipcRenderer.on('private-mode-changed', (_e, v) => cb(v)),
  onHotkeyMinimise: (cb) => ipcRenderer.on('hotkey-minimise', () => cb()),
});
