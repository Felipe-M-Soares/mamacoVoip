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
  // o esquema completo. Recebe uma lista de nomes de processo (não mais
  // um label do KNOWN_GAMES) — generalizado pra funcionar com qualquer
  // jogo/app, não só os cadastrados.
  startForegroundWatch: (processNames) => ipcRenderer.invoke('game-foreground-watch:start', processNames),
  stopForegroundWatch: () => ipcRenderer.invoke('game-foreground-watch:stop'),
  onGameForegroundChanged: (callback) => {
    const handler = (_event, focused) => callback(focused)
    ipcRenderer.on('game-foreground-changed', handler)
    return () => ipcRenderer.removeListener('game-foreground-changed', handler)
  },
  // Auto-parar o compartilhamento de tela cheia quando o processo
  // compartilhado fecha de vez — ver electron/main.cjs.
  watchProcessExit: (processNames) => ipcRenderer.invoke('game-share:watch-process-exit', processNames),
  stopWatchProcessExit: () => ipcRenderer.invoke('game-share:stop-watch-process-exit'),
  onWatchedProcessExited: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('watched-process-exited', handler)
    return () => ipcRenderer.removeListener('watched-process-exited', handler)
  },
  // Login com Google — o processo principal manda pra cá a URL de
  // volta (mamacovoip://...) assim que o sistema operacional entrega o
  // link de callback depois da pessoa aceitar no navegador. Ver o
  // bloco grande no topo de electron/main.cjs pra entender o esquema
  // completo.
  onGoogleAuthCallback: (callback) => {
    const handler = (_event, url) => callback(url)
    ipcRenderer.on('google-auth-callback', handler)
    return () => ipcRenderer.removeListener('google-auth-callback', handler)
  },
})
