const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  detectGames: () => ipcRenderer.invoke('detect-games'),
  getGame: () => ipcRenderer.invoke('get-game'),
  startAudio: () => ipcRenderer.invoke('start-audio'),
  stopAudio: () => ipcRenderer.invoke('stop-audio'),
  shareScreen: (sourceId, gameName) => 
    ipcRenderer.invoke('share-screen', { sourceId, gameName }),
  onGameStatus: (cb) => {
    ipcRenderer.on('game-status', (event, data) => cb(data));
  },
  onAudioData: (cb) => {
    ipcRenderer.on('audio-data', (event, data) => cb(data));
  },
  removeListener: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    ipcRenderer.send('shortcut', 'share-screen');
  }
});
