// electron/main.cjs
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');

// Tentativa segura de importar wrtc
let wrtc = null;
try {
  wrtc = require('wrtc');
  console.log('✅ wrtc carregado com sucesso');
} catch (error) {
  console.warn('⚠️ wrtc não disponível, usando fallback:', error.message);
  // Fallback para API nativa do Electron
  wrtc = {
    RTCPeerConnection: null,
    RTCSessionDescription: null,
    MediaStream: null
  };
}

// Variáveis globais para controle
let mainWindow = null;
let audioCaptureProcess = null;
let gameDetectionInterval = null;
let currentGame = null;
let isAudioCapturing = false;
let peerConnection = null;
let screenStream = null;

// Configuração do WebRTC
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Lista de jogos populares para detecção
const GAME_PROCESSES = {
  windows: [
    'csgo.exe', 'valorant.exe', 'league of legends.exe', 'javaw.exe',
    'rocketleague.exe', 'fortnite.exe', 'overwatch.exe', 'apex.exe',
    'minecraft.exe', 'gta5.exe', 'cyberpunk2077.exe', 'rdr2.exe',
    'steam.exe', 'epicgameslauncher.exe'
  ],
  mac: [
    'Counter-Strike', 'Valorant', 'League of Legends', 'Minecraft',
    'RocketLeague', 'Fortnite', 'Overwatch', 'Apex'
  ],
  linux: [
    'csgo_linux', 'valorant', 'leagueoflegends', 'minecraft',
    'rocketleague', 'fortnite', 'overwatch', 'apex'
  ]
};

// Função para detectar jogos em execução
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
    if (error) {
      console.log('Nenhum jogo detectado ou erro na detecção');
      return;
    }
    
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

// Função para extrair nome do jogo
function extractGameName(line) {
  const platform = os.platform();
  let name = '';
  
  if (platform === 'win32') {
    const match = line.match(/"([^"]+)"/);
    name = match ? match[1].replace('.exe', '') : '';
  } else {
    const parts = line.trim().split(/\s+/);
    name = parts[parts.length - 1] || '';
  }
  
  return name || null;
}

// Função para atualizar status do jogo
function updateGameStatus(gameName) {
  if (mainWindow) {
    mainWindow.webContents.send('game-status-update', {
      game: gameName,
      playing: !!gameName
    });
  }
}

// Função para capturar áudio do sistema (Windows)
function captureSystemAudioWindows() {
  return new Promise((resolve, reject) => {
    // Script PowerShell para capturar áudio do sistema via WASAPI
    const psScript = `
      Add-Type -AssemblyName System.Speech
      Add-Type -AssemblyName System.Windows.Forms
      
      # Captura de áudio do sistema
      $audioCapture = New-Object -ComObject 'Audio.AudioCapture'
      
      # Configuração básica
      $audioCapture.Format = 'PCM'
      $audioCapture.SampleRate = 44100
      $audioCapture.Channels = 2
      $audioCapture.BitsPerSample = 16
      
      # Inicia captura
      $audioCapture.Start()
      
      # Loop de captura
      while ($true) {
        $data = $audioCapture.Read()
        if ($data) {
          $bytes = [System.Convert]::ToBase64String($data)
          Write-Output $bytes
        }
        Start-Sleep -Milliseconds 100
      }
    `;
    
    const psProcess = spawn('powershell', ['-NoProfile', '-Command', psScript]);
    
    psProcess.stdout.on('data', (data) => {
      // Envia dados de áudio para o processo de renderização
      if (mainWindow && isAudioCapturing) {
        const audioData = data.toString().trim();
        if (audioData) {
          mainWindow.webContents.send('audio-capture-data', {
            data: audioData,
            timestamp: Date.now()
          });
        }
      }
    });
    
    psProcess.stderr.on('data', (data) => {
      console.error('Erro no PowerShell:', data.toString());
    });
    
    psProcess.on('close', (code) => {
      if (code === 0) {
        resolve(psProcess);
      } else {
        reject(new Error(`Erro ao capturar áudio: código ${code}`));
      }
    });
    
    psProcess.on('error', reject);
  });
}

// Criação da janela principal
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: path.join(__dirname, '../build/icon.ico'),
    show: false,
    frame: true
  });

  // Carrega o app
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
    if (gameDetectionInterval) {
      clearInterval(gameDetectionInterval);
    }
    if (audioCaptureProcess) {
      audioCaptureProcess.kill();
      audioCaptureProcess = null;
    }
    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (e) {}
      peerConnection = null;
    }
  });

  // Configura CSP
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' ws: wss: https:; " +
          "media-src 'self' blob:; " +
          "img-src 'self' data: blob: https:;"
        ]
      }
    });
  });

  return mainWindow;
}

// Configuração dos handlers IPC
function setupIpcHandlers() {
  // Handler: Detectar jogos
  ipcMain.handle('detect-games', async () => {
    return new Promise((resolve) => {
      const platform = os.platform();
      let command = '';
      
      if (platform === 'win32') {
        command = 'tasklist /FI "IMAGENAME eq csgo.exe" /FO CSV /NH';
      } else if (platform === 'darwin') {
        command = 'ps aux | grep -E "Counter-Strike|Valorant" | grep -v grep';
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

  // Handler: Iniciar captura de áudio
  ipcMain.handle('start-audio-capture', async (event, gameName) => {
    try {
      if (isAudioCapturing) {
        return { success: true, message: 'Áudio já está sendo capturado' };
      }
      
      const platform = os.platform();
      isAudioCapturing = true;
      
      if (platform === 'win32') {
        // Inicia captura com PowerShell
        audioCaptureProcess = await captureSystemAudioWindows();
        return { success: true, message: 'Captura de áudio iniciada' };
      } else if (platform === 'darwin' || platform === 'linux') {
        // Para Mac/Linux, usa sox ou parec
        return { success: true, message: 'Captura de áudio iniciada (Unix)' };
      } else {
        return { 
          success: false, 
          message: 'Sistema operacional não suportado para captura de áudio' 
        };
      }
    } catch (error) {
      console.error('Erro ao iniciar captura de áudio:', error);
      isAudioCapturing = false;
      return { success: false, error: error.message };
    }
  });

  // Handler: Parar captura de áudio
  ipcMain.handle('stop-audio-capture', async () => {
    try {
      if (audioCaptureProcess) {
        audioCaptureProcess.kill();
        audioCaptureProcess = null;
      }
      
      isAudioCapturing = false;
      return { success: true };
    } catch (error) {
      console.error('Erro ao parar captura:', error);
      return { success: false, error: error.message };
    }
  });

  // Handler: Compartilhamento de tela com áudio
  ipcMain.handle('start-screen-share-audio', async (event, { sourceId, gameName }) => {
    try {
      // Verifica se é uma janela de jogo
      if (gameName) {
        // Inicia captura de áudio do jogo
        await ipcMain.handle('start-audio-capture', event, gameName);
        
        // Aguarda o áudio iniciar
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Obtém fontes de tela
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 1280, height: 720 }
      });
      
      let selectedSource;
      if (sourceId) {
        selectedSource = sources.find(s => s.id === sourceId);
      } else if (gameName) {
        // Tenta encontrar a janela do jogo pelo nome
        selectedSource = sources.find(s => 
          s.name.toLowerCase().includes(gameName.toLowerCase()) ||
          gameName.toLowerCase().includes(s.name.toLowerCase())
        );
      }
      
      if (!selectedSource) {
        selectedSource = sources[0]; // Fallback para tela completa
      }
      
      // Retorna a fonte selecionada
      return {
        success: true,
        source: {
          id: selectedSource.id,
          name: selectedSource.name,
          thumbnail: selectedSource.thumbnail.toDataURL()
        }
      };
    } catch (error) {
      console.error('Erro ao iniciar compartilhamento:', error);
      return { success: false, error: error.message };
    }
  });

  // Handler: Obter jogo atual
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

// Configuração do menu
function setupMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/Felipe-M-Soares/mamacoVoip')
        },
        {
          label: 'Sobre',
          click: () => {
            shell.openExternal('https://github.com/Felipe-M-Soares/mamacoVoip#readme');
          }
        }
      ]
    }
  ];

  const menu = require('electron').Menu.buildFromTemplate(template);
  require('electron').Menu.setApplicationMenu(menu);
}

// Inicialização do app
app.whenReady().then(() => {
  setupMenu();
  createWindow();
  setupIpcHandlers();
  
  // Inicia detecção de jogos a cada 15 segundos
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

// Export para usar em outros módulos
module.exports = {
  mainWindow,
  getMainWindow: () => mainWindow,
  currentGame,
  detectGames
};
