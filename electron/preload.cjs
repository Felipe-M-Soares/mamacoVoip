const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getCurrentGame: () => ipcRenderer.invoke('app:getCurrentGame'),
  setGameDetectionEnabled: (enabled) => ipcRenderer.invoke('app:setGameDetectionEnabled', !!enabled),
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
  getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
  getScreenShareSources: () => ipcRenderer.invoke('screen-share:get-sources'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  selectScreenShareSource: (sourceId) => ipcRenderer.invoke('screen-share:select', sourceId),
  pinFallbackShareSource: (sourceId) => ipcRenderer.invoke('screen-share:pin-fallback-source', sourceId),
  focusAppWindow: () => ipcRenderer.send('app:focus-window'),
  showNotification: (payload) => ipcRenderer.invoke('notify:show', payload),
  onNotificationClick: (callback) => {
    const handler = (_event, target) => callback(target)
    ipcRenderer.on('notify:clicked', handler)
    return () => ipcRenderer.removeListener('notify:clicked', handler)
  },
  flashWindow: () => ipcRenderer.send('window:flash'),
  isGlobalPTTAvailable: () => ipcRenderer.invoke('ptt:is-global-available'),
  startPTTCapture: () => ipcRenderer.invoke('ptt:start-capture'),
  setGlobalPTTKey: (keycode) => ipcRenderer.invoke('ptt:set-active-key', keycode),
  onPTTState: (callback) => {
    const handler = (_event, active) => callback(active)
    ipcRenderer.on('ptt-state', handler)
    return () => ipcRenderer.removeListener('ptt-state', handler)
  },
  sendVoiceStateToOverlay: (state) => ipcRenderer.send('overlay:update-state', state),
  getOverlaySettings: () => ipcRenderer.invoke('overlay:get-settings'),
  setOverlayVisible: (visible) => ipcRenderer.invoke('overlay:set-visible', visible),
  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  setOverlayCorner: (corner) => ipcRenderer.invoke('overlay:set-corner', corner),
  setOverlayOpacity: (opacity) => ipcRenderer.invoke('overlay:set-opacity', opacity),
  getVideoEncodeSettings: () => ipcRenderer.invoke('video:get-encode-settings'),
  setPreferGpuEncode: (preferGpu) => ipcRenderer.invoke('video:set-prefer-gpu', preferGpu),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  setTitleBarColors: (colors) => ipcRenderer.invoke('window:set-titlebar-colors', colors),
  getAutoStart: () => ipcRenderer.invoke('app:get-autostart'),
  setAutoStart: (enabled) => ipcRenderer.invoke('app:set-autostart', enabled),
  getSystemIdleSeconds: () => ipcRenderer.invoke('app:system-idle-seconds'),
  onOverlayVisibilityChanged: (callback) => {
    const handler = (_event, visible) => callback(visible)
    ipcRenderer.on('overlay:visibility-changed', handler)
    return () => ipcRenderer.removeListener('overlay:visibility-changed', handler)
  },
  getCurrentGameInfo: () => ipcRenderer.invoke('app:getCurrentGameInfo'),
  checkForUpdatesNow: () => ipcRenderer.send('app:check-for-updates-now'),
  startForegroundWatch: (processNames) => ipcRenderer.invoke('game-foreground-watch:start', processNames),
  stopForegroundWatch: () => ipcRenderer.invoke('game-foreground-watch:stop'),
  onGameForegroundChanged: (callback) => {
    const handler = (_event, focused) => callback(focused)
    ipcRenderer.on('game-foreground-changed', handler)
    return () => ipcRenderer.removeListener('game-foreground-changed', handler)
  },
  setGlobalKeybinds: (list) => ipcRenderer.invoke('keybinds:set-global', list),
  onKeybind: (callback) => {
    const handler = (_e, id) => callback(id)
    ipcRenderer.on('keybind', handler)
    return () => ipcRenderer.removeListener('keybind', handler)
  },
  watchProcessExit: (processNames) => ipcRenderer.invoke('game-share:watch-process-exit', processNames),
  stopWatchProcessExit: () => ipcRenderer.invoke('game-share:stop-watch-process-exit'),
  onWatchedProcessExited: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('watched-process-exited', handler)
    return () => ipcRenderer.removeListener('watched-process-exited', handler)
  },
  startProcessAudioCapture: (pid) => ipcRenderer.invoke('process-audio:start', pid),
  startSystemAudioExcludingSelf: () => ipcRenderer.invoke('process-audio:start-excluding-self'),
  stopProcessAudioCapture: () => ipcRenderer.invoke('process-audio:stop'),
  onProcessAudioFormat: (callback) => {
    const handler = (_event, format) => callback(format)
    ipcRenderer.on('process-audio:format', handler)
    return () => ipcRenderer.removeListener('process-audio:format', handler)
  },
  onProcessAudioChunk: (callback) => {
    const handler = (_event, chunk) => callback(chunk)
    ipcRenderer.on('process-audio:chunk', handler)
    return () => ipcRenderer.removeListener('process-audio:chunk', handler)
  },
  onProcessAudioError: (callback) => {
    const handler = (_event, message) => callback(message)
    ipcRenderer.on('process-audio:error', handler)
    return () => ipcRenderer.removeListener('process-audio:error', handler)
  },
  startScreenCaptureWgcFallback: (monitorIndex) => ipcRenderer.invoke('screen-capture-wgc:start', monitorIndex),
  stopScreenCaptureWgcFallback: () => ipcRenderer.invoke('screen-capture-wgc:stop'),
  onScreenCaptureWgcFormat: (callback) => {
    const handler = (_event, format) => callback(format)
    ipcRenderer.on('screen-capture-wgc:format', handler)
    return () => ipcRenderer.removeListener('screen-capture-wgc:format', handler)
  },
  onScreenCaptureWgcFrame: (callback) => {
    const handler = (_event, frame) => callback(frame)
    ipcRenderer.on('screen-capture-wgc:frame', handler)
    return () => ipcRenderer.removeListener('screen-capture-wgc:frame', handler)
  },
  onScreenCaptureWgcError: (callback) => {
    const handler = (_event, message) => callback(message)
    ipcRenderer.on('screen-capture-wgc:error', handler)
    return () => ipcRenderer.removeListener('screen-capture-wgc:error', handler)
  },
  startScreenCaptureGdiFallback: (monitorIndex) => ipcRenderer.invoke('screen-capture-gdi:start', monitorIndex),
  stopScreenCaptureGdiFallback: () => ipcRenderer.invoke('screen-capture-gdi:stop'),
  onScreenCaptureGdiFormat: (callback) => {
    const handler = (_event, format) => callback(format)
    ipcRenderer.on('screen-capture-gdi:format', handler)
    return () => ipcRenderer.removeListener('screen-capture-gdi:format', handler)
  },
  onScreenCaptureGdiFrame: (callback) => {
    const handler = (_event, frame) => callback(frame)
    ipcRenderer.on('screen-capture-gdi:frame', handler)
    return () => ipcRenderer.removeListener('screen-capture-gdi:frame', handler)
  },
  onScreenCaptureGdiError: (callback) => {
    const handler = (_event, message) => callback(message)
    ipcRenderer.on('screen-capture-gdi:error', handler)
    return () => ipcRenderer.removeListener('screen-capture-gdi:error', handler)
  },
  onGoogleAuthCallback: (callback) => {
    const handler = (_event, url) => callback(url)
    ipcRenderer.on('google-auth-callback', handler)
    return () => ipcRenderer.removeListener('google-auth-callback', handler)
  },
  logDebug: (message) => ipcRenderer.send('debug:log', message),
  secureStorage: {
    getItem: (key) =>
      typeof key === 'string' && (key.startsWith('sb-') || key === 'mv-user-notes')
        ? ipcRenderer.invoke('secure-storage:get', key)
        : Promise.resolve({ ok: false }),
    setItem: (key, value) =>
      typeof key === 'string' && (key.startsWith('sb-') || key === 'mv-user-notes') && typeof value === 'string'
        ? ipcRenderer.invoke('secure-storage:set', key, value)
        : Promise.resolve({ ok: false }),
    removeItem: (key) =>
      typeof key === 'string' && (key.startsWith('sb-') || key === 'mv-user-notes')
        ? ipcRenderer.invoke('secure-storage:remove', key)
        : Promise.resolve({ ok: false }),
  },
})
