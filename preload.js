const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('deck', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  iconForPath: (p) => ipcRenderer.invoke('icon:forPath', p),
  iconForUrl: (u) => ipcRenderer.invoke('icon:forUrl', u),
  resolveDrop: (p) => ipcRenderer.invoke('drop:resolve', p),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return (file && file.path) || ''; }
  },
  sysStats: () => ipcRenderer.invoke('sys:stats'),
  weather: () => ipcRenderer.invoke('weather:get'),
  saverAddVideo: () => ipcRenderer.invoke('saver:addVideo'),
  saverImportVideo: (p) => ipcRenderer.invoke('saver:importVideo', p),
  saverRemoveVideo: (it) => ipcRenderer.invoke('saver:removeVideo', it),
  saverSaveTemplate: (d) => ipcRenderer.invoke('saver:saveTemplate', d),
  toFileUrl: (p) => { try { return pathToFileURL(String(p)).href; } catch { return ''; } },
  pickApp: () => ipcRenderer.invoke('dialog:pickApp'),
  pickAny: (dir) => ipcRenderer.invoke('dialog:pickAny', dir),
  pickIcon: () => ipcRenderer.invoke('dialog:pickIcon'),
  launch: (btn) => ipcRenderer.invoke('action:launch', btn),
  minimize: () => ipcRenderer.send('win:minimize'),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('win:quit')
});
