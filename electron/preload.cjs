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
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
  restartToUpdate: () => ipcRenderer.invoke('app:restartToUpdate'),
  onScreenShareSources: (callback) => {
    const handler = (_event, sources) => callback(sources)
    ipcRenderer.on('screen-share-sources', handler)
    return () => ipcRenderer.removeListener('screen-share-sources', handler)
  },
  selectScreenShareSource: (sourceId, includeSystemAudio) =>
    ipcRenderer.invoke('screen-share:select', sourceId, includeSystemAudio),
  focusAppWindow: () => ipcRenderer.send('app:focus-window'),
  isGlobalPTTAvailable: () => ipcRenderer.invoke('ptt:is-global-available'),
  startPTTCapture: () => ipcRenderer.invoke('ptt:start-capture'),
  setGlobalPTTKey: (keycode) => ipcRenderer.invoke('ptt:set-active-key', keycode),
  onPTTState: (callback) => {
    const handler = (_event, active) => callback(active)
    ipcRenderer.on('ptt-state', handler)
    return () => ipcRenderer.removeListener('ptt-state', handler)
  },
  sendVoiceStateToOverlay: (state) => ipcRenderer.send('overlay:update-state', state),
  checkForUpdatesNow: () => ipcRenderer.send('app:check-for-updates-now'),
  // Vigia de foco do jogo (mitigação de vazamento em compartilhamento de
  // tela inteira) — ver o bloco grande em electron/main.cjs pra entender
  // o esquema completo.
  startForegroundWatch: (gameLabel) => ipcRenderer.invoke('game-foreground-watch:start', gameLabel),
  stopForegroundWatch: () => ipcRenderer.invoke('game-foreground-watch:stop'),
  onGameForegroundChanged: (callback) => {
    const handler = (_event, focused) => callback(focused)
    ipcRenderer.on('game-foreground-changed', handler)
    return () => ipcRenderer.removeListener('game-foreground-changed', handler)
  },
})
