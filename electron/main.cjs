const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');

let mainWindow = null;
let audioProcess = null;
let gameInterval = null;
let currentGame = null;
let isCapturing = false;

// Lista de jogos
const GAMES = {
  windows: [
    'csgo.exe', 'valorant.exe', 'league of legends.exe', 'javaw.exe',
    'rocketleague.exe', 'fortnite.exe', 'overwatch.exe', 'apex.exe',
    'minecraft.exe', 'gta5.exe', 'cyberpunk2077.exe'
  ],
  mac: ['Counter-Strike', 'Valorant', 'League of Legends', 'Minecraft'],
  linux: ['csgo_linux', 'valorant', 'leagueoflegends', 'minecraft']
};

// Detecta jogos
function detectGames() {
  const platform = os.platform();
  let cmd = '';
  
  if (platform === 'win32') {
    const list = GAMES.windows.map(g => `IMAGENAME eq "${g}"`).join(' or ');
    cmd = `tasklist /FI "${list}" /FO CSV /NH`;
  } else {
    cmd = `ps aux | grep -E "${GAMES[platform === 'darwin' ? 'mac' : 'linux'].join('|')}" | grep -v grep`;
  }
  
  exec(cmd, (error, stdout) => {
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

// Captura áudio do sistema (Windows)
function captureAudioWindows() {
  return new Promise((resolve, reject) => {
    const script = `
      $AudioCapture = New-Object -ComObject 'Audio.AudioCapture'
      $AudioCapture.Format = 'PCM'
      $AudioCapture.SampleRate = 44100
      $AudioCapture.Channels = 2
      $AudioCapture.BitsPerSample = 16
      $AudioCapture.Start()
      
      while ($true) {
        $data = $AudioCapture.Read()
        if ($data) {
          [System.Convert]::ToBase64String($data)
        }
        Start-Sleep -Milliseconds 50
      }
    `;
    
    const proc = spawn('powershell', ['-NoProfile', '-Command', script]);
    
    proc.stdout.on('data', (data) => {
      if (mainWindow && isCapturing) {
        const audio = data.toString().trim();
        if (audio) {
          mainWindow.webContents.send('audio-data', {
            data: audio,
            timestamp: Date.now()
          });
        }
      }
    });
    
    proc.stderr.on('data', (data) => {
      console.error('Audio error:', data.toString());
    });
    
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
    if (gameInterval) clearInterval(gameInterval);
    if (audioProcess) audioProcess.kill();
  });

  return mainWindow;
}

function setupIpc() {
  ipcMain.handle('detect-games', async () => {
    return new Promise((resolve) => {
      const platform = os.platform();
      let cmd = platform === 'win32' 
        ? 'tasklist /FI "IMAGENAME eq csgo.exe" /FO CSV /NH'
        : 'ps aux | grep -E "csgo|valorant" | grep -v grep';
      
      exec(cmd, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ success: false, games: [] });
          return;
        }
        const games = stdout.split('\n')
          .filter(l => l.trim())
          .map(l => l.trim().split(/\s+/).pop() || 'Jogo');
        resolve({ success: true, games });
      });
    });
  });

  ipcMain.handle('start-audio', async () => {
    try {
      if (isCapturing) return { success: true };
      
      if (os.platform() === 'win32') {
        audioProcess = await captureAudioWindows();
        isCapturing = true;
        return { success: true, message: 'Áudio capturado' };
      }
      
      return { success: false, message: 'Apenas Windows suportado' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-audio', async () => {
    try {
      if (audioProcess) {
        audioProcess.kill();
        audioProcess = null;
      }
      isCapturing = false;
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
}

app.whenReady().then(() => {
  createWindow();
  setupIpc();
  gameInterval = setInterval(detectGames, 15000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
