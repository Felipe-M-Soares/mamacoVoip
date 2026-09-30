const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  // AUDITORIA: antes cada chamada somava um listener novo e nunca removia
  // nenhum — devolve agora uma função de "cancelar inscrição", no mesmo
  // padrão do preload principal.
  onVoiceState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('overlay:voice-state', handler)
    return () => ipcRenderer.removeListener('overlay:voice-state', handler)
  },
  // Canto escolhido nas configurações ({ corner }) — a página alinha a
  // lista pro lado/borda certos (ver overlay.html).
  onSettings: (callback) => {
    const handler = (_event, settings) => callback(settings)
    ipcRenderer.on('overlay:settings', handler)
    return () => ipcRenderer.removeListener('overlay:settings', handler)
  },
})
