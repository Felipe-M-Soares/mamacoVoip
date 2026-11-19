const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  onVoiceState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('overlay:voice-state', handler)
    return () => ipcRenderer.removeListener('overlay:voice-state', handler)
  },
  onShown: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('overlay:shown', handler)
    return () => ipcRenderer.removeListener('overlay:shown', handler)
  },
  onSettings: (callback) => {
    const handler = (_event, settings) => callback(settings)
    ipcRenderer.on('overlay:settings', handler)
    return () => ipcRenderer.removeListener('overlay:settings', handler)
  },
})
