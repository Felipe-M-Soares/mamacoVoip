// electron/main.cjs
const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');

// 🔥 Importa o autoUpdater
const { autoUpdater } = require('electron-updater');

// ============ CONFIGURAÇÃO DO AUTO-UPDATER ============
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Eventos do auto-updater (para debug)
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Verificando atualizações...');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'checking');
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('✅ Atualização disponível! Versão:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'available', info);
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('ℹ️ App está atualizado.');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'not-available');
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`📦 Download: ${Math.round(progressObj.percent)}%`);
  if (mainWindow) {
    mainWindow.webContents.send('update-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', () => {
  console.log('✅ Atualização baixada. Instalando...');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded');
  }
  autoUpdater.quitAndInstall();
});

autoUpdater.on('error', (err) => {
  console.error('❌ Erro no auto-updater:', err);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', err.message);
  }
});

// ============ RESTO DO CÓDIGO (mainWindow, ipc, etc.) ============
let mainWindow = null;
let audioCaptureProcess = null;
let gameDetectionInterval = null;
let currentGame = null;
let isAudioCapturing = false;

// Lista de jogos
const GAME_PROCESSES = {
  windows: ['csgo.exe', 'valorant.exe', 'league of legends.exe', 'javaw.exe', 'rocketleague.exe', 'fortnite.exe', 'overwatch.exe', 'apex.exe'],
  mac: ['Counter-Strike', 'Valorant', 'League of Legends', 'Minecraft'],
  linux: ['csgo_linux', 'valorant', 'leagueoflegends', 'minecraft']
};

function detectGames() {
  const platform = os.platform();
  let command = '';
  if (platform === 'win32') {
    const list = GAME_PROCESSES.windows.map(g => `IMAGENAME eq "${g}"`).join(' or ');
    command = `tasklist /FI "${list}" /FO CSV /NH`;
  } else {
    command = `ps aux | grep -E "${GAME_PROCESSES[platform === 'darwin' ? 'mac' : 'linux'].join('|')}" | grep -v grep`;
  }
  exec(command, (error, stdout) => {
    if (error || !stdout.trim()) return;
    const games = stdout.split('\n').filter(l => l.trim());
    if (games.length > 0) {
      const name = extractGameName(games[0]);
      if (name && name !== currentGame) {
        currentGame = name;
        if (mainWindow) {
          mainWindow.webContents.send('game-status', { game: name, playing: true });
        }
      }
    } else if (currentGame) {
      currentGame = null;
      if (mainWindow) {
        mainWindow.webContents.send('game-status', { game: null, playing: false });
      }
    }
  });
}

function extractGameName(line) {
  if (os.platform() === 'win32') {
    const match = line.match(/"([^"]+)"/);
    return match ? match[1].replace('.exe', '') : null;
  }
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1] || null;
}

function captureAudioWindows() {
  return new Promise((resolve, reject) => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $audioCapture = New-Object -ComObject 'Audio.AudioCapture'
      $audioCapture.Format = 'PCM'
      $audioCapture.SampleRate = 44100
      $audioCapture.Channels = 2
      $audioCapture.BitsPerSample = 16
      $audioCapture.Start()
      while ($true) {
        $data = $audioCapture.Read()
        if ($data) {
          [System.Convert]::ToBase64String($data)
        }
        Start-Sleep -Milliseconds 50
      }
    `;
    const proc = spawn('powershell', ['-NoProfile', '-Command', script]);
    proc.stdout.on('data', (data) => {
      if (mainWindow && isAudioCapturing) {
        const audio = data.toString().trim();
        if (audio) {
          mainWindow.webContents.send('audio-data', { data: audio, timestamp: Date.now() });
        }
      }
    });
    proc.stderr.on('data', (data) => console.error('Audio error:', data.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(proc);
      else reject(new Error(`Audio capture failed: ${code}`));
    });
    proc.on('error', reject);
    resolve(proc);
  });
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

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (gameDetectionInterval) clearInterval(gameDetectionInterval);
    if (audioCaptureProcess) audioCaptureProcess.kill();
  });

  return mainWindow;
}

function setupIpc() {
  ipcMain.handle('detect-games', async () => {
    return new Promise((resolve) => {
      const platform = os.platform();
      const cmd = platform === 'win32' 
        ? 'tasklist /FI "IMAGENAME eq csgo.exe" /FO CSV /NH'
        : 'ps aux | grep -E "csgo|valorant" | grep -v grep';
      exec(cmd, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ success: false, games: [] });
          return;
        }
        const games = stdout.split('\n').filter(l => l.trim()).map(l => l.trim().split(/\s+/).pop() || 'Jogo');
        resolve({ success: true, games });
      });
    });
  });

  ipcMain.handle('start-audio', async () => {
    try {
      if (isAudioCapturing) return { success: true };
      if (os.platform() === 'win32') {
        audioCaptureProcess = await captureAudioWindows();
        isAudioCapturing = true;
        return { success: true, message: 'Áudio capturado' };
      }
      return { success: false, message: 'Apenas Windows suportado' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-audio', async () => {
    try {
      if (audioCaptureProcess) {
        audioCaptureProcess.kill();
        audioCaptureProcess = null;
      }
      isAudioCapturing = false;
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('share-screen', async (event, { sourceId, gameName }) => {
    try {
      if (gameName) {
        await ipcMain.handle('start-audio');
        await new Promise(r => setTimeout(r, 500));
      }
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 1280, height: 720 }
      });
      let selected = sourceId 
        ? sources.find(s => s.id === sourceId)
        : sources.find(s => gameName && s.name.toLowerCase().includes(gameName.toLowerCase()));
      if (!selected) selected = sources[0];
      return {
        success: true,
        source: {
          id: selected.id,
          name: selected.name,
          thumbnail: selected.thumbnail.toDataURL()
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-game', async () => {
    return new Promise((resolve) => {
      const platform = os.platform();
      const cmd = platform === 'win32'
        ? 'tasklist /FI "IMAGENAME eq csgo.exe" /FO CSV /NH'
        : 'ps aux | grep -E "csgo|valorant" | grep -v grep';
      exec(cmd, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ success: false, game: null });
          return;
        }
        const lines = stdout.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          const name = extractGameName(lines[0]);
          resolve({ success: true, game: name });
        } else {
          resolve({ success: false, game: null });
        }
      });
    });
  });

  // Handler para forçar verificação de atualização manual
  ipcMain.handle('check-for-updates', async () => {
    try {
      console.log('🔍 Verificando atualizações manualmente...');
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (error) {
      console.error('❌ Erro ao verificar atualizações:', error);
      return { success: false, error: error.message };
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  setupIpc();
  gameDetectionInterval = setInterval(detectGames, 15000);

  // 🔥 FORÇA A VERIFICAÇÃO DE ATUALIZAÇÃO EM PRODUÇÃO
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    console.log('🚀 Verificando atualizações...');
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 🔥 Exporta o autoUpdater para uso em outros módulos (opcional)
module.exports = { autoUpdater };
