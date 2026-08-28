// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

// API exposta para o processo de renderização
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Funções existentes ---
  
  // Detecta jogos em execução
  detectGames: () => ipcRenderer.invoke('detect-games'),
  
  // Obtém o jogo atual
  getCurrentGame: () => ipcRenderer.invoke('get-current-game'),
  
  // --- NOVAS FUNÇÕES PARA ÁUDIO ---
  
  // Inicia captura de áudio do sistema
  startAudioCapture: (gameName) => ipcRenderer.invoke('start-audio-capture', gameName),
  
  // Para captura de áudio
  stopAudioCapture: () => ipcRenderer.invoke('stop-audio-capture'),
  
  // Inicia compartilhamento de tela com áudio
  startScreenShareWithAudio: (sourceId, gameName) => 
    ipcRenderer.invoke('start-screen-share-audio', { sourceId, gameName }),
  
  // --- Event listeners ---
  
  // Escuta atualizações de status do jogo
  onGameStatusUpdate: (callback) => {
    ipcRenderer.on('game-status-update', (event, data) => callback(data));
  },
  
  // Escuta dados de áudio capturado
  onAudioData: (callback) => {
    ipcRenderer.on('audio-capture-data', (event, data) => callback(data));
  },
  
  // Escuta erros de áudio
  onAudioError: (callback) => {
    ipcRenderer.on('audio-capture-error', (event, error) => callback(error));
  },
  
  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// Adiciona handlers para comunicação
window.addEventListener('DOMContentLoaded', () => {
  // Inicializa listeners de teclado
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+S - Compartilhar tela com áudio
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      ipcRenderer.send('keyboard-shortcut', 'screen-share-audio');
    }
  });
});

// Exporta para uso
module.exports = { contextBridge, ipcRenderer };
