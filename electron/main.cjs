const { app, BrowserWindow, session, Menu, Tray, nativeImage, Notification, shell, ipcMain, dialog, protocol, net, desktopCapturer, globalShortcut } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { exec } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

// Push-to-talk GLOBAL (funciona mesmo com o app fora de foco, tipo
// com um jogo em tela cheia). Isso depende de um módulo nativo
// (uiohook-napi) que só existe pra certas combinações de sistema
// operacional/arquitetura — por isso é carregado só na primeira vez
// que a pessoa realmente tentar usar isso (não toda vez que o app
// abre), e todo uso fica protegido: se falhar em carregar ou iniciar
// (plataforma sem suporte, permissão de Acessibilidade negada no
// macOS, Linux sem X11, etc.), o push-to-talk continua funcionando do
// jeito antigo (só com o app em foco), sem afetar mais nada no app.
let uIOhook = null
let UiohookKey = null
let uiohookAvailable = null // null = ainda não tentou carregar

function tryLoadUiohook() {
  if (uiohookAvailable !== null) return uiohookAvailable
  try {
    const uiohook = require('uiohook-napi')
    uIOhook = uiohook.uIOhook
    UiohookKey = uiohook.UiohookKey
    uiohookAvailable = true
  } catch (err) {
    console.error('uiohook-napi indisponível — push-to-talk global desativado, só funciona com o app em foco:', err?.message)
    uiohookAvailable = false
  }
  return uiohookAvailable
}

const isDev = !app.isPackaged

// Rede de segurança geral: se algum erro escapar de todos os try/catch
// (de qualquer parte do app, não só do push-to-talk), isso evita que
// ele derrube o processo principal inteiro — o que travaria o app
// inteiro pra todo mundo, muito pior do que uma função específica
// falhar sozinha.
process.on('uncaughtException', (err) => {
  console.error('Erro não tratado no processo principal:', err)
})

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
  // Tiro/competitivo
  'valorant.exe': 'Valorant',
  'valorant-win64-shipping.exe': 'Valorant',
  'csgo.exe': 'Counter-Strike',
  'cs2.exe': 'Counter-Strike 2',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_be.exe': 'Rainbow Six Siege',
  'rainbowsix_vulkan.exe': 'Rainbow Six Siege',
  'rainbowsix_dx11.exe': 'Rainbow Six Siege',
  'r5apex.exe': 'Apex Legends',
  'overwatch.exe': 'Overwatch 2',
  'pubg.exe': 'PUBG: Battlegrounds',
  'tslgame.exe': 'PUBG: Battlegrounds',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'destiny2.exe': 'Destiny 2',
  'thefinals.exe': 'The Finals',
  'delta_force.exe': 'Delta Force',

  // Battle royale / multiplayer casual
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'robloxplayerbeta.exe': 'Roblox',
  'among us.exe': 'Among Us',
  'amongus.exe': 'Among Us',

  // MOBA
  'league of legends.exe': 'League of Legends',
  'leagueclient.exe': 'League of Legends',
  'dota2.exe': 'Dota 2',
  'smite.exe': 'Smite',

  // Mundo aberto / RPG / ação
  'gta5.exe': 'GTA V',
  'gta5_enhanced.exe': 'GTA V',
  'eldenring.exe': 'Elden Ring',
  'starfield.exe': 'Starfield',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'reddeadredemption2.exe': 'Red Dead Redemption 2',
  'rdr2.exe': 'Red Dead Redemption 2',
  'skyrimse.exe': 'Skyrim',
  'baldur\'s gate 3.exe': "Baldur's Gate 3",
  'bg3.exe': "Baldur's Gate 3",
  'hogwartslegacy.exe': 'Hogwarts Legacy',
  'palworld.exe': 'Palworld',
  'blackmythwukong.exe': 'Black Myth: Wukong',

  // Sandbox / construção / sobrevivência
  'javaw.exe': 'Minecraft',
  'minecraft.exe': 'Minecraft',
  'minecraftlauncher.exe': 'Minecraft',
  'terraria.exe': 'Terraria',
  'rust.exe': 'Rust',
  'dayzps.exe': 'DayZ',
  'dayz_x64.exe': 'DayZ',
  'ark.exe': 'ARK: Survival Evolved',
  'arkascended.exe': 'ARK: Survival Ascended',
  'valheim.exe': 'Valheim',
  '7daystodie.exe': '7 Days to Die',
  'stardewvalley.exe': 'Stardew Valley',

  // Esportes / corrida
  'rocketleague.exe': 'Rocket League',
  'fc24.exe': 'EA Sports FC 24',
  'fc25.exe': 'EA Sports FC 25',
  'nba2k24.exe': 'NBA 2K24',
  'forzahorizon5.exe': 'Forza Horizon 5',
  'assettocorsa.exe': 'Assetto Corsa',

  // Outros populares
  'wow.exe': 'World of Warcraft',
  'wowclassic.exe': 'World of Warcraft',
  'ffxiv_dx11.exe': 'Final Fantasy XIV',
  'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail',
  'wutheringwaves.exe': 'Wuthering Waves',
  'phasmophobia.exe': 'Phasmophobia',
  'lethalcompany.exe': 'Lethal Company',
  'helldivers2.exe': 'Helldivers 2',
  'palia.exe': 'Palia',
  'sea of thieves.exe': 'Sea of Thieves',
  'seaofthieves.exe': 'Sea of Thieves',
  'itsvertigo.exe': 'Vertigo',
}

// Combina o nome do processo (chave do dicionário acima) SEM a
// extensão .exe também, já que no Mac/Linux processos não costumam
// ter esse sufixo — melhora um pouco a cobertura fora do Windows,
// mesmo que a lista tenha sido pensada primariamente pra ele.
const GAME_CHECK_INTERVAL_MS = 15_000

let mainWindow = null
let isQuitting = false
let pendingDisplayMediaCallback = null
let updateReadyToInstall = false
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

let overlayWindow = null
let overlayVisible = false

// Sobreposição dentro de jogos — janela transparente, sem borda,
// sempre por cima, que só mostra quem está na call e quem tá falando.
// Fica "clique-através" (ignora o mouse) o tempo todo, porque não tem
// nenhum botão nela — é só informação, pra não atrapalhar o jogo.
//
// LIMITAÇÃO CONHECIDA: funciona bem com o jogo em janela sem borda,
// mas normalmente NÃO aparece por cima de jogos em tela cheia
// exclusiva — mesma limitação técnica do compartilhamento de tela,
// sem solução sem uma ferramenta bem mais arriscada (hook de DirectX).
function createOverlayWindow() {
  const overlay = new BrowserWindow({
    width: 280,
    height: 200,
    x: 40,
    y: 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'overlay-preload.cjs'),
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setIgnoreMouseEvents(true)
  overlay.loadFile(path.join(__dirname, 'overlay.html'))
  overlay.hide()
  return overlay
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
      // Sem isso, o Chromium desacelera os timers de JavaScript quando a
      // janela fica escondida (minimizada pra bandeja, por exemplo) —
      // incluindo o timer que a Supabase usa pra renovar o login antes
      // dele expirar. Ficando escondido tempo suficiente, o token
      // expirava sem renovar e a pessoa parecia "deslogada" ao reabrir
      // o app. Manter os timers rodando normal resolve isso (e também
      // mantém a call de voz/chamadas ativas corretamente em segundo
      // plano).
      backgroundThrottling: false,
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

  // Minimizar/fechar a janela vai pra bandeja do sistema em vez de
  // sumir da barra de tarefas ou encerrar o app — igual o Discord de
  // verdade faz, pra continuar recebendo notificações/call em segundo
  // plano sem ocupar espaço na barra de tarefas.
  win.on('minimize', (event) => {
    event.preventDefault()
    win.hide()
  })
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })

  mainWindow = win
  return win
}

let tray = null

function createTray(win) {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'splash-logo.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Mamacos Voip')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Mamacos Voip',
      click: () => {
        win.show()
        win.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  // Clique simples no ícone também abre a janela (padrão que a
  // maioria dos apps de bandeja segue no Windows)
  tray.on('click', () => {
    if (win.isVisible()) {
      win.focus()
    } else {
      win.show()
      win.focus()
    }
  })
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
    try {
      if (!sourceId) {
        // Cancelamento (usuário clicou fora ou em "Cancelar"). Chamar o
        // callback com um objeto vazio é como o Electron espera que a
        // gente negue o pedido — mas isso pode lançar uma exceção
        // interna dependendo da versão, por isso o try/catch em volta.
        resolve({})
        return
      }
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const source = sources.find((s) => s.id === sourceId)
      resolve(source ? { video: source, audio: 'loopback' } : {})
    } catch {
      // Engolir aqui de propósito — sem isso, cancelar o compartilhamento
      // de tela derrubava o app inteiro (o erro escapava até o processo
      // renderer via IPC e acionava a tela de "Erro ao iniciar o app").
    }
  })

  Menu.setApplicationMenu(null)

  const splash = createSplashWindow()
  const win = createWindow()
  createTray(win)

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

  // --- Overlay dentro de jogos -----------------------------------
  overlayWindow = createOverlayWindow()

  // O app principal manda o estado atual da call pra cá sempre que
  // muda (quem tá na sala, quem tá falando, quem tá mudo) — só
  // repassa pra janela do overlay, sem guardar nada aqui.
  ipcMain.on('overlay:update-state', (_event, state) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay:voice-state', state)
    }
  })

  // Atalho global (funciona mesmo com o jogo em foco) pra ligar/desligar
  // a sobreposição — usa o mecanismo embutido do próprio Electron
  // (não depende do módulo nativo do push-to-talk), já que só precisa
  // reagir a "tecla apertada", não "segurando ou não".
  const registered = globalShortcut.register('Control+Shift+O', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    overlayVisible = !overlayVisible
    if (overlayVisible) overlayWindow.showInactive()
    else overlayWindow.hide()
  })
  if (!registered) {
    console.error('Não foi possível registrar o atalho da sobreposição (Ctrl+Shift+O) — pode já estar em uso por outro programa.')
  }

  startGameDetection()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getCurrentGame', () => currentGame)

  // --- Push-to-talk global -----------------------------------------
  let pttGlobalKeycode = null
  let pttCaptureResolver = null
  let uiohookStarted = false
  let uiohookListenersAttached = false

  function attachUiohookListeners() {
    if (uiohookListenersAttached) return
    uiohookListenersAttached = true
    uIOhook.on('keydown', (e) => {
      if (pttCaptureResolver) {
        const resolve = pttCaptureResolver
        pttCaptureResolver = null
        const name = Object.entries(UiohookKey).find(([, code]) => code === e.keycode)?.[0] ?? `Tecla ${e.keycode}`
        resolve({ keycode: e.keycode, name })
        return
      }
      if (pttGlobalKeycode !== null && e.keycode === pttGlobalKeycode) {
        mainWindow?.webContents.send('ptt-state', true)
      }
    })
    uIOhook.on('keyup', (e) => {
      if (pttGlobalKeycode !== null && e.keycode === pttGlobalKeycode) {
        mainWindow?.webContents.send('ptt-state', false)
      }
    })
  }

  function ensureUiohookStarted() {
    if (uiohookStarted) return true
    if (!tryLoadUiohook()) return false
    try {
      attachUiohookListeners()
      uIOhook.start()
      uiohookStarted = true
      return true
    } catch (err) {
      // Acontece principalmente no macOS sem permissão de
      // Acessibilidade concedida, ou em ambientes Linux sem X11 —
      // desiste de vez do modo global pra essa sessão do app.
      console.error('Falha ao iniciar uiohook (push-to-talk vai funcionar só com o app em foco):', err?.message)
      uiohookAvailable = false
      return false
    }
  }

  ipcMain.handle('ptt:is-global-available', () => tryLoadUiohook())

  ipcMain.handle('ptt:start-capture', () => {
    if (!ensureUiohookStarted()) return Promise.resolve(null)
    return new Promise((resolve) => {
      pttCaptureResolver = resolve
      // Se ninguém apertar nada em 10s, desiste — evita ficar
      // "escutando" pra sempre se a pessoa fechar a janelinha sem
      // escolher tecla nenhuma.
      setTimeout(() => {
        if (pttCaptureResolver === resolve) {
          pttCaptureResolver = null
          resolve(null)
        }
      }, 10_000)
    })
  })

  ipcMain.handle('ptt:set-active-key', (_event, keycode) => {
    pttGlobalKeycode = typeof keycode === 'number' ? keycode : null
    if (pttGlobalKeycode !== null) ensureUiohookStarted()
  })

  app.once('before-quit', () => {
    isQuitting = true
    if (uiohookAvailable && uiohookStarted) {
      try {
        uIOhook.stop()
      } catch {
        // já estamos fechando o app mesmo, sem problema
      }
    }
  })
  // -------------------------------------------------------------------

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
    autoUpdater.on('update-downloaded', (info) => {
      updateReadyToInstall = true
      sendUpdateStatus('ready', { version: info.version })
      // Como o app pode estar escondido na bandeja (minimizado) quando
      // isso acontece, a pessoa não veria o aviso na tela — o tooltip
      // do ícone e uma notificação nativa avisam mesmo assim.
      if (tray) tray.setToolTip(`Mamacos Voip — atualização v${info.version} pronta (reinicie pra aplicar)`)
      if (Notification.isSupported()) {
        new Notification({
          title: 'Atualização pronta',
          body: `Mamacos Voip v${info.version} já foi baixado. Reinicie o app pra aplicar.`,
        }).show()
      }
    })
    let updateRetryCount = 0
    const MAX_UPDATE_RETRIES = 6

    autoUpdater.on('error', (err) => {
      // Antes a gente só olhava err.message, que às vezes vem bem curto
      // ("404" sozinho) sem dizer QUAL endpoint falhou. Isso pega todas
      // as propriedades do erro (inclusive as que não aparecem em
      // JSON.stringify por padrão) pra dar um diagnóstico de verdade.
      let raw = 'Erro desconhecido'
      try {
        raw = JSON.stringify(err, Object.getOwnPropertyNames(err))
      } catch {
        raw = err?.message ?? String(err)
      }

      // Um release recém-publicado pode demorar alguns minutos pra o
      // GitHub "enxergar" ele como o mais recente (atraso normal de
      // indexação do próprio GitHub, não é bug daqui) — isso costuma
      // aparecer como 404 bem na primeira checagem depois de abrir o
      // app. Em vez de desistir na hora, tenta de novo com uma pausa
      // curta antes de qualquer coisa.
      if (raw.includes('404') && updateRetryCount < MAX_UPDATE_RETRIES) {
        updateRetryCount++
        setTimeout(() => {
          autoUpdater.checkForUpdates().catch(() => {})
        }, 25_000)
        return
      }

      // Esse app não tem certificado de assinatura de código (custa
      // dinheiro, ~R$1.000-3.000/ano) — e no Windows, o electron-updater
      // confirma a assinatura digital do instalador antes de aplicar a
      // atualização baixada. Sem assinatura, essa verificação falha e a
      // atualização baixa mas NÃO se aplica sozinha. Isso aparece
      // tipicamente como "sha512 checksum mismatch" ou menção a
      // "signature"/"publisher" na mensagem de erro.
      const looksLikeSignatureIssue = /signature|publisher|checksum|sha512/i.test(raw)
      if (looksLikeSignatureIssue) {
        sendUpdateStatus('error', {
          message:
            'A atualização foi baixada mas não pôde ser verificada automaticamente (provavelmente porque o instalador não tem assinatura digital — isso exige um certificado pago). Baixe a versão mais recente manualmente pelo site.',
          downloadUrl: 'https://github.com/Felipe-M-Soares/mamacoVoip/releases/latest',
        })
        return
      }

      sendUpdateStatus('error', { message: raw.slice(0, 400), downloadUrl: 'https://github.com/Felipe-M-Soares/mamacoVoip/releases/latest' })
    })

    ipcMain.handle('app:restartToUpdate', () => autoUpdater.quitAndInstall())
    ipcMain.on('app:check-for-updates-now', () => {
      updateRetryCount = 0
      autoUpdater.checkForUpdates().catch(() => {})
    })

    // O provedor "github" padrão usa o feed releases.atom do GitHub pra
    // checar a versão mais recente — e isso já foi confirmado, direto
    // no navegador, que dá 404 nesse repositório específico. Por isso
    // aponta pro mesmo link "releases/latest/download/" que o botão de
    // baixar usa (que sabemos que funciona). O "?noCache=" que o
    // electron-updater anexa nesse link é uma fonte conhecida de 404 em
    // ALGUNS tipos de servidor genérico — mas não há confirmação de que
    // isso afete o GitHub especificamente, então mantemos essa
    // abordagem em vez de trocar por outra com um problema já
    // confirmado e pior.
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/Felipe-M-Soares/mamacoVoip/releases/latest/download/',
    })

    // A checagem em si só dispara depois que a janela terminou de
    // carregar (+ uma folga extra) — se disparasse aqui, os avisos de
    // "verificando"/"baixando" seriam mandados pro app ANTES dele
    // terminar de montar e começar a escutar essas mensagens, e se
    // perderiam no caminho (por isso nenhum aviso aparecia na tela).
    win.once('ready-to-show', () => {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {
          // sem conexão ou nenhum release publicado ainda — o evento 'error'
          // acima já avisa a janela, então não precisa fazer nada aqui além
          // de não deixar isso impedir o app de abrir
        })
      }, 1500)

      // Checar só quando o app abre não é suficiente — muita gente
      // deixa o app aberto o dia inteiro, e nesse caso uma atualização
      // publicada nesse meio tempo só seria vista no próximo reinício
      // (que podia demorar dias). Rechecando a cada 30 minutos, uma
      // atualização nova chega bem mais rápido pra quem já está com o
      // app aberto, sem precisar fechar e abrir de novo.
      setInterval(
        () => {
          if (!updateReadyToInstall) {
            autoUpdater.checkForUpdates().catch(() => {})
          }
        },
        30 * 60 * 1000
      )
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
  globalShortcut.unregisterAll()
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  if (process.platform !== 'darwin') {
    // Se uma atualização já terminou de baixar em segundo plano, instala
    // e reabre o app automaticamente ao fechar — a pessoa não precisa
    // clicar em "Reiniciar", só fechar e abrir o app normalmente já
    // basta pra receber a versão nova.
    if (updateReadyToInstall) {
      autoUpdater.quitAndInstall()
    } else {
      app.quit()
    }
  }
})

