const { app, BrowserWindow, session, Menu, shell, ipcMain } = require('electron')
const path = require('node:path')
const { exec } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

// Lista de processos conhecidos mapeados pro nome bonito que aparece
// no status ("Jogando X"). Detecção é por nome de processo em
// execução — funciona bem no Windows (onde a maioria dos jogos roda);
// no Mac/Linux o nome do processo costuma ser diferente, então a
// cobertura ali é mais limitada. Isso só existe no app desktop porque
// nenhum navegador dá acesso à lista de processos do sistema por
// motivo de segurança — é uma limitação de qualquer navegador, não
// só do nosso app.
const KNOWN_GAMES = {
  'valorant.exe': 'Valorant',
  'javaw.exe': 'Minecraft',
  'minecraft.exe': 'Minecraft',
  'csgo.exe': 'Counter-Strike',
  'cs2.exe': 'Counter-Strike 2',
  'league of legends.exe': 'League of Legends',
  'leagueclient.exe': 'League of Legends',
  'gta5.exe': 'GTA V',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends',
  'destiny2.exe': 'Destiny 2',
  'overwatch.exe': 'Overwatch 2',
  'dota2.exe': 'Dota 2',
  'rocketleague.exe': 'Rocket League',
  'eldenring.exe': 'Elden Ring',
  'robloxplayerbeta.exe': 'Roblox',
  'among us.exe': 'Among Us',
  'terraria.exe': 'Terraria',
}

const GAME_CHECK_INTERVAL_MS = 15_000

let mainWindow = null
let gameCheckTimer = null
let currentGame = null

function detectRunningGame() {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'win32' ? 'tasklist' : process.platform === 'darwin' ? 'ps -Ao comm' : 'ps -eo comm'

    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null)
        return
      }
      const lower = stdout.toLowerCase()
      for (const [processName, label] of Object.entries(KNOWN_GAMES)) {
        if (lower.includes(processName)) {
          resolve(label)
          return
        }
      }
      resolve(null)
    })
  })
}

function startGameDetection() {
  if (gameCheckTimer) return
  gameCheckTimer = setInterval(async () => {
    const game = await detectRunningGame()
    if (game !== currentGame) {
      currentGame = game
      mainWindow?.webContents.send('game-status-changed', game)
    }
  }, GAME_CHECK_INTERVAL_MS)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: true,
  })

  if (isDev) {
    // Em desenvolvimento, aponta pro servidor do Vite (rode `npm run dev`
    // em outro terminal antes de `npm run electron:start`)
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Links externos (ex: um convite colado em outro app) abrem no
  // navegador padrão do sistema, não dentro da janela do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow = win
  return win
}

app.whenReady().then(() => {
  // O app web pede permissão de microfone/câmera/compartilhamento de tela
  // via getUserMedia/getDisplayMedia — sem isso o Electron bloqueia por
  // padrão e a Fase 8 (voz) não funcionaria dentro do app desktop.
  // Essas são TODAS as permissões que o app já vai pedir, aceitas de
  // uma vez aqui na configuração do processo principal.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'notifications']
    callback(allowed.includes(permission))
  })

  Menu.setApplicationMenu(null)

  createWindow()
  startGameDetection()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getCurrentGame', () => currentGame)

  if (!isDev) {
    // Checa, baixa e notifica sobre atualizações automaticamente.
    // Exige que "build.publish" esteja configurado (veja package.json)
    // e que exista pelo menos um release publicado no provedor escolhido.
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // sem conexão ou nenhum release publicado ainda — falha silenciosa,
      // não deve impedir o app de abrir
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (gameCheckTimer) clearInterval(gameCheckTimer)
  if (process.platform !== 'darwin') app.quit()
})
