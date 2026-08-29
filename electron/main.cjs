// electron/main.cjs
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');

let mainWindow = null;
let nativeAudioCapture = null;
let gameDetectionInterval = null;
let currentGame = null;
let isAudioCapturing = false;

// Tenta carregar o módulo nativo
let AudioCapture = null;
try {
  const nativePath = path.join(__dirname, '..', 'native', 'build', 'Release', 'audio_capture.node');
  if (require('fs').existsSync(nativePath)) {
    const nativeModule = require(nativePath);
    AudioCapture = nativeModule.AudioCapture;
    console.log('✅ Módulo nativo de áudio carregado');
  }
} catch (error) {
  console.warn('⚠️ Módulo nativo não disponível:', error.message);
}

// Lista de jogos
const GAME_PROCESSES = {
  windows: [
    'csgo.exe', 'valorant.exe', 'league of legends.exe', 'javaw.exe',
    'rocketleague.exe', 'fortnite.exe', 'overwatch.exe', 'apex.exe',
    'minecraft.exe', 'gta5.exe', 'cyberpunk2077.exe', 'rdr2.exe'
  ],
  mac: [
    'Counter-Strike', 'Valorant', 'League of Legends', 'Minecraft'
  ],
  linux: [
    'csgo_linux', 'valorant', 'leagueoflegends', 'minecraft'
  ]
};

// Detecta jogos
function detectGames() {
  const platform = os.platform();
  let command = '';
  
  if (platform === 'win32') {
    const gameList = GAME_PROCESSES.windows.map(g => `IMAGENAME eq "${g}"`).join(' or ');
    command = `tasklist /FI "${gameList}" /FO CSV /NH`;
  } else if (platform === 'darwin') {
    command = 'ps aux | grep -E "' + GAME_PROCESSES.mac.join('|') + '" | grep -v grep';
  } else {
    command = 'ps aux | grep -E "' + GAME_PROCESSES.linux.join('|') + '" | grep -v grep';
  }
  
  exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) return;
    
    const games = stdout.split('\n').filter(line => line.trim());
    if (games.length > 0) {
      const gameName = extractGameName(games[0]);
      if (gameName && gameName !== currentGame) {
        currentGame = gameName;
        updateGameStatus(gameName);
      }
    } else {
      if (currentGame) {
        currentGame = null;
        updateGameStatus(null);
      }
    }
  });
}

function extractGameName(line) {
  const platform = os.platform();
  if (platform === 'win32') {
    const match = line.match(/"([^"]+)"/);
    return match ? match[1].replace('.exe', '') : null;
  }
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1] || null;
}

function updateGameStatus(gameName) {
  if (mainWindow) {
    mainWindow.webContents.send('game-status-update', {
      game: gameName,
      playing: !!gameName
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    show: false
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (gameDetectionInterval) clearInterval(gameDetectionInterval);
    if (nativeAudioCapture) {
      try { nativeAudioCapture.stop(); } catch(e) {}
    }
  });

  return mainWindow;
}

function setupIpcHandlers() {
  // Detectar jogos
  ipcMain.handle('detect-games', async () => {
    return new Promise((resolve) => {
      const platform = os.platform();
      let command = '';
      
      if (platform === 'win32') {
        command = 'tasklist /FI "IMAGENAME eq csgo.exe" /FO CSV /NH';
      } else {
        command = 'ps aux | grep -E "csgo|valorant" | grep -v grep';
      }
      
      exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ success: false, games: [] });
          return;
        }
        
        const games = stdout.split('\n')
          .filter(line => line.trim())
          .map(line => {
            const parts = line.trim().split(/\s+/);
            return parts[parts.length - 1] || 'Jogo Desconhecido';
          });
        
        resolve({ success: true, games });
      });
    });
  });

  // Iniciar captura de áudio nativa
  ipcMain.handle('start-audio-capture', async (event, gameName) => {
    try {
      if (!AudioCapture) {
        return { 
          success: false, 
          message: 'Módulo nativo não disponível. Use a versão web.' 
        };
      }

      if (isAudioCapturing) {
        return { success: true, message: 'Áudio já está capturando' };
      }

      // Cria instância do capturador nativo
      nativeAudioCapture = new AudioCapture((data) => {
        // Callback recebe dados de áudio
        if (mainWindow && isAudioCapturing) {
          mainWindow.webContents.send('audio-capture-data', {
            data: data.toString('base64'),
            timestamp: Date.now()
          });
        }
      });

      // Inicia captura
      const started = nativeAudioCapture.start();
      if (started) {
        isAudioCapturing = true;
        return { success: true, message: 'Captura de áudio nativa iniciada' };
      } else {
        return { success: false, message: 'Falha ao iniciar captura' };
      }
    } catch (error) {
      console.error('Erro:', error);
      return { success: false, error: error.message };
    }
  });

  // Parar captura
  ipcMain.handle('stop-audio-capture', async () => {
    try {
      if (nativeAudioCapture) {
        nativeAudioCapture.stop();
        nativeAudioCapture = null;
      }
      isAudioCapturing = false;
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Compartilhar tela com áudio
  ipcMain.handle('start-screen-share-audio', async (event, { sourceId, gameName }) => {
    try {
      if (gameName) {
        await ipcMain.handle('start-audio-capture', event, gameName);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 1280, height: 720 }
      });
      
      let selectedSource;
      if (sourceId) {
        selectedSource = sources.find(s => s.id === sourceId);
      } else if (gameName) {
        selectedSource = sources.find(s => 
          s.name.toLowerCase().includes(gameName.toLowerCase()) ||
          gameName.toLowerCase().includes(s.name.toLowerCase())
        );
      }
      
      if (!selectedSource) {
        selectedSource = sources[0];
      }
      
      return {
        success: true,
        source: {
          id: selectedSource.id,
          name: selectedSource.name,
          thumbnail: selectedSource.thumbnail.toDataURL()
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Obter jogo atual
  ipcMain.handle('get-current-game', async () => {
    return new Promise((resolve) => {
      const platform = os.platform();
      let command = '';
      
      if (platform === 'win32') {
        command = 'tasklist /FI "IMAGENAME eq csgo.exe" /FO CSV /NH';
      } else {
        command = 'ps aux | grep -E "csgo|valorant" | grep -v grep';
      }
      
      exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ success: false, game: null });
          return;
        }
        
        const lines = stdout.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
          const gameName = extractGameName(lines[0]);
          resolve({ success: true, game: gameName });
        } else {
          resolve({ success: false, game: null });
        }
      });
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();
  
  gameDetectionInterval = setInterval(detectGames, 15000);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

module.exports = { mainWindow };
