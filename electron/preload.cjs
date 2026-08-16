const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getCurrentGame: () => ipcRenderer.invoke('app:getCurrentGame'),
  onGameStatusChanged: (callback) => {
    const handler = (_event, game) => callback(game)
    ipcRenderer.on('game-status-changed', handler)
    return () => ipcRenderer.removeListener('game-status-changed', handler)
  },
})
