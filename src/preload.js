const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (s) => ipcRenderer.invoke('settings:save', s),
  sessionsList: () => ipcRenderer.invoke('sessions:list'),
  sessionsSave: (s) => ipcRenderer.invoke('sessions:save', s),
  sessionsDelete: (id) => ipcRenderer.invoke('sessions:delete', id),
  privateMode: () => ipcRenderer.invoke('app:private-mode'),
  togglePrivate: () => ipcRenderer.invoke('app:toggle-private'),
  hide: () => ipcRenderer.invoke('app:hide'),
  minimise: () => ipcRenderer.invoke('app:minimise'),
  quit: () => ipcRenderer.invoke('app:quit'),
  captureSources: () => ipcRenderer.invoke('capture:sources'),
  pickResume: () => ipcRenderer.invoke('resume:pick-file'),
  groqChat: (args) => ipcRenderer.invoke('groq:chat', args),
  groqVision: (args) => ipcRenderer.invoke('groq:vision', args),
  groqTranscribe: (args) => ipcRenderer.invoke('groq:transcribe', args),
  onPrivateMode: (cb) => ipcRenderer.on('private-mode-changed', (_e, v) => cb(v)),
  onHotkeyMinimise: (cb) => ipcRenderer.on('hotkey-minimise', () => cb()),
});
