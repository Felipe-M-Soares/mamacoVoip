const { app, BrowserWindow, session, Menu, shell, ipcMain } = require('electron')
const path = require('node:path')
const { exec } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

// URL/arquivo que o app tem permissão de carregar — qualquer tentativa
// de navegar pra outro lugar (ex: um link malicioso injetado de algum
// jeito) é bloqueada e reaberta no navegador do sistema em vez de
// substituir o conteúdo da janela do app.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const PROD_INDEX_FILE = path.join(__dirname, '..', 'dist', 'index.html')

function isAllowedNavigation(url) {
  if (isDev) return url.startsWith(DEV_SERVER_URL)
  try {
    return new URL(url).protocol === 'file:' && url.includes('index.html')
  } catch {
    return false
  }
}

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

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 320,
    height: 320,
    frame: false,
    resizable: false,
    movable: false,
    transparent: false,
    backgroundColor: '#09090a',
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  return splash
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false, // só aparece quando o conteúdo estiver pronto (troca suave com a splash)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // --- Checklist de segurança do Electron (electronjs.org/docs/latest/tutorial/security) ---
      contextIsolation: true, // o mundo JS da página NUNCA compartilha escopo com o preload/Node
      nodeIntegration: false, // a página web não tem acesso a require()/Node de jeito nenhum
      sandbox: true, // processo de renderização roda com privilégios mínimos do SO
      webSecurity: true, // mantém same-origin policy e bloqueios de conteúdo misto ativos
      allowRunningInsecureContent: false, // nunca carrega http:// dentro de um contexto https/file
      webviewTag: false, // desativa a tag <webview>, uma superfície de ataque clássica no Electron
      spellcheck: false,
    },
    autoHideMenuBar: true,
  })

  if (isDev) {
    // Em desenvolvimento, aponta pro servidor do Vite (rode `npm run dev`
    // em outro terminal antes de `npm run electron:start`)
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(PROD_INDEX_FILE)
  }

  // Bloqueia navegação pra qualquer lugar que não seja o próprio app —
  // se algo tentar redirecionar a janela (XSS, link malicioso, etc.),
  // isso é barrado aqui e a URL abre no navegador do sistema, fora do
  // contexto privilegiado do Electron.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

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
  // Content-Security-Policy: mesmo o app já sendo same-origin (só
  // carrega o próprio dist/index.html), isso é uma segunda camada
  // contra XSS — impede que qualquer script/estilo/conexão de origem
  // não autorizada rode dentro da janela, mesmo que algum conteúdo
  // malicioso consiga se injetar na página por outro meio.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data: blob: https:; " +
            "media-src 'self' blob:; " +
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co stun:stun.l.google.com stun:stun1.l.google.com; " +
            "object-src 'none'; " +
            "base-uri 'self';",
        ],
      },
    })
  })

  // O app web pede permissão de microfone/câmera/compartilhamento de tela
  // via getUserMedia/getDisplayMedia — sem isso o Electron bloqueia por
  // padrão e a Fase 8 (voz) não funcionaria dentro do app desktop.
  // Essas são TODAS as permissões que o app já vai pedir, aceitas de
  // uma vez aqui na configuração do processo principal — qualquer
  // permissão fora dessa lista (geolocalização, sensores, etc.) é
  // negada por padrão, mesmo que algum código tente pedir.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'notifications']
    callback(allowed.includes(permission))
  })

  Menu.setApplicationMenu(null)

  const splash = createSplashWindow()
  const win = createWindow()

  win.once('ready-to-show', () => {
    splash.close()
    win.show()
  })

  startGameDetection()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getCurrentGame', () => currentGame)

  if (!isDev) {
    // Checa, baixa e notifica sobre atualizações automaticamente.
    // Exige que "build.publish" esteja configurado (veja package.json)
    // e que exista pelo menos um release publicado no provedor escolhido.
    // electron-updater também valida a ASSINATURA do instalador antes
    // de aplicar a atualização (veja seção de assinatura de código no
    // README) — sem isso, atualizações automáticas são um vetor de
    // ataque em vez de proteção.
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // sem conexão ou nenhum release publicado ainda — falha silenciosa,
      // não deve impedir o app de abrir
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Segunda camada de defesa contra novas janelas fora de controle —
// mesmo que algo escape do setWindowOpenHandler, qualquer BrowserWindow
// criada nasce com as mesmas restrições de segurança do app inteiro.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.on('window-all-closed', () => {
  if (gameCheckTimer) clearInterval(gameCheckTimer)
  if (process.platform !== 'darwin') app.quit()
})

