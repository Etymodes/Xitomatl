const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xitomatlDesktop', Object.freeze({
  setReminderFullscreen(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new TypeError('enabled must be a boolean'));
    return ipcRenderer.invoke('xitomatl:set-reminder-fullscreen', enabled);
  },
}));
