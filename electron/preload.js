/* 화면(index.html)이 쓸 수 있는 앱 기능만 좁게 열어준다 */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['notif-action', 'notif-failed', 'set-mode', 'focus-quick', 'win-state'];

contextBridge.exposeInMainWorld('dayline', {
  isApp: true,
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggleMax'),
  close: () => ipcRenderer.send('win:close'),
  quit: () => ipcRenderer.send('app:quit'),
  setMode: (m) => ipcRenderer.send('win:setMode', m),
  setPinned: (v) => ipcRenderer.send('win:setPinned', !!v),
  notify: (p) => ipcRenderer.send('notify', p),
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  setAutostart: (v) => ipcRenderer.invoke('app:setAutostart', !!v),
  setStartShow: (v) => ipcRenderer.invoke('app:setStartShow', !!v),
  readStickyNotes: () => ipcRenderer.invoke('sticky:read'),
  backup: (json, kind) => ipcRenderer.invoke('backup:write', String(json), kind === 'before' ? 'before' : 'daily'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (file) => ipcRenderer.invoke('backup:read', String(file)),
  capture: () => ipcRenderer.invoke('win:capture'),
  copyImage: (dataUrl) => ipcRenderer.invoke('clip:image', String(dataUrl)),
  sendFeedback: (url, json) => ipcRenderer.invoke('feedback:send', String(url), String(json)),
  openBackupDir: () => ipcRenderer.invoke('backup:openDir'),
  saveImage: (dataUrl) => ipcRenderer.invoke('img:save', String(dataUrl)),
  deleteImage: (file) => ipcRenderer.invoke('img:delete', String(file)),
  openImage: (file) => ipcRenderer.invoke('img:open', String(file)),
  on: (ch, cb) => {
    if (!CHANNELS.includes(ch)) return;
    ipcRenderer.on(ch, (_e, data) => cb(data));
  },
});
