// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  detectGames: () => ipcRenderer.invoke('detect-games'),
  getCurrentGame: () => ipcRenderer.invoke('get-current-game'),
  startAudioCapture: (gameName) => ipcRenderer.invoke('start-audio-capture', gameName),
  stopAudioCapture: () => ipcRenderer.invoke('stop-audio-capture'),
  startScreenShareWithAudio: (sourceId, gameName) => 
    ipcRenderer.invoke('start-screen-share-audio', { sourceId, gameName }),
  onGameStatusUpdate: (callback) => {
    ipcRenderer.on('game-status-update', (event, data) => callback(data));
  },
  onAudioData: (callback) => {
    ipcRenderer.on('audio-capture-data', (event, data) => callback(data));
  },
  onAudioError: (callback) => {
    ipcRenderer.on('audio-capture-error', (event, error) => callback(error));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      ipcRenderer.send('keyboard-shortcut', 'screen-share-audio');
    }
  });
});

module.exports = { contextBridge, ipcRenderer };
