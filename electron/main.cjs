const { app, BrowserWindow, session, Menu, shell, ipcMain, dialog, protocol, net, desktopCapturer } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { exec } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

const isDev = !app.isPackaged

// URL/arquivo que o app tem permissão de carregar — qualquer tentativa
// de navegar pra outro lugar (ex: um link malicioso injetado de algum
// jeito) é bloqueada e reaberta no navegador do sistema em vez de
// substituir o conteúdo da janela do app.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const DIST_DIR = path.join(__dirname, '..', 'dist')

// Em produção, o app é servido por um protocolo próprio ("app://")
// em vez de abrir o index.html direto do disco (file://). O Chromium
// BLOQUEIA em silêncio a execução de módulos JavaScript modernos
// quando carregados via file:// — a página "carrega" sem erro nenhum
// visível, só o script nunca roda. Servindo pelo protocolo próprio, o
// app passa a ter uma origem de verdade e os módulos funcionam normal.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

function isAllowedNavigation(url) {
  if (isDev) return url.startsWith(DEV_SERVER_URL)
  try {
    return new URL(url).protocol === 'app:'
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
let pendingDisplayMediaCallback = null
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
    win.loadURL('app://bundle/index.html')
  }

  // Se o arquivo/página falhar ao carregar (ex: caminho errado, arquivo
  // ausente), mostra um alerta nativo do sistema automaticamente — sem
  // isso, uma falha de carregamento vira só uma tela preta muda, sem
  // nenhuma pista visível de por que.
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return // ERR_ABORTED — comum durante navegação normal, não é erro de verdade
    dialog.showErrorBox(
      'Mamacos Voip — falha ao carregar',
      `Código: ${errorCode}\nDescrição: ${errorDescription}\nCaminho: ${validatedURL}`,
    )
  })

  // Se a página carregar mas travar depois (aba/processo interno
  // morreu), avisa também — outro jeito comum de "tela preta muda".
  win.webContents.on('render-process-gone', (_event, details) => {
    dialog.showErrorBox('Mamacos Voip — processo travou', `Motivo: ${details.reason}`)
  })

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
  // Serve os arquivos de dist/ através do protocolo "app://" — é isso
  // que substitui o antigo win.loadFile(file://...) e resolve o
  // bloqueio silencioso de módulos JS do Chromium.
  if (!isDev) {
    protocol.handle('app', (request) => {
      const parsedUrl = new URL(request.url)
      let pathname = decodeURIComponent(parsedUrl.pathname)
      if (pathname === '' || pathname === '/') pathname = '/index.html'
      const filePath = path.join(DIST_DIR, pathname)

      // Nunca serve nada fora da pasta dist/ (evita path traversal tipo "../../../etc/passwd")
      if (!filePath.startsWith(DIST_DIR)) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    })
  }

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

  // Diferente de um navegador comum, o Electron não tem um seletor de
  // tela/janela embutido — sem isso, o botão de compartilhar tela fica
  // "morto" (o pedido de getDisplayMedia() nunca resolve). Em vez de
  // escolher a tela automaticamente, manda a lista de telas/janelas
  // disponíveis (com miniatura) pro app mostrar um seletor de verdade,
  // e espera a pessoa escolher.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: true,
      })
      pendingDisplayMediaCallback = callback
      mainWindow?.webContents.send(
        'screen-share-sources',
        sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
      )
    } catch {
      callback({})
    }
  })

  ipcMain.handle('screen-share:select', async (_event, sourceId) => {
    if (!pendingDisplayMediaCallback) return
    const resolve = pendingDisplayMediaCallback
    pendingDisplayMediaCallback = null
    if (!sourceId) {
      resolve({})
      return
    }
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const source = sources.find((s) => s.id === sourceId)
    resolve(source ? { video: source, audio: 'loopback' } : {})
  })

  Menu.setApplicationMenu(null)

  const splash = createSplashWindow()
  const win = createWindow()

  win.once('ready-to-show', () => {
    splash.close()
    win.show()
  })

  win.webContents.once('did-fail-load', () => {
    if (!splash.isDestroyed()) splash.close()
  })
  win.webContents.once('render-process-gone', () => {
    if (!splash.isDestroyed()) splash.close()
  })

  startGameDetection()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getCurrentGame', () => currentGame)

  if (!isDev) {
    // Checa, baixa e aplica atualizações — cada etapa é avisada pra
    // janela principal via IPC, pra mostrar um indicador visual (em vez
    // de tudo acontecer em silêncio como antes). Exige que
    // "build.publish" esteja configurado (veja package.json) e que
    // exista pelo menos um release publicado no provedor escolhido.
    // electron-updater também valida a ASSINATURA do instalador antes
    // de aplicar a atualização (veja seção de assinatura de código no
    // README) — sem isso, atualizações automáticas são um vetor de
    // ataque em vez de proteção.
    function sendUpdateStatus(status, extra = {}) {
      mainWindow?.webContents.send('update-status', { status, ...extra })
    }

    autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'))
    autoUpdater.on('update-available', (info) => sendUpdateStatus('downloading', { version: info.version }))
    autoUpdater.on('update-not-available', () => sendUpdateStatus('up-to-date'))
    autoUpdater.on('download-progress', (progress) =>
      sendUpdateStatus('downloading', { percent: Math.round(progress.percent) })
    )
    autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('ready', { version: info.version }))
    autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: err?.message ?? 'Erro desconhecido' }))

    ipcMain.handle('app:restartToUpdate', () => autoUpdater.quitAndInstall())

    autoUpdater.checkForUpdates().catch(() => {
      // sem conexão ou nenhum release publicado ainda — o evento 'error'
      // acima já avisa a janela, então não precisa fazer nada aqui além
      // de não deixar isso impedir o app de abrir
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

