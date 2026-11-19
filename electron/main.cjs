const { app, BrowserWindow, session, Menu, Tray, nativeImage, Notification, shell, ipcMain, dialog, protocol, net, desktopCapturer, globalShortcut, screen, powerMonitor, safeStorage, clipboard } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFile, spawn } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  return
}

function videoEncodeSettingsPath() {
  return path.join(app.getPath('userData'), 'video-encode-settings.json')
}
function loadVideoEncodeSettings() {
  try {
    return JSON.parse(require('node:fs').readFileSync(videoEncodeSettingsPath(), 'utf8')) ?? {}
  } catch {
    return {}
  }
}
function loadPreferGpuEncode() {
  return loadVideoEncodeSettings().preferGpu !== false
}
const preferGpuEncodeAtStartup = loadPreferGpuEncode()
if (preferGpuEncodeAtStartup && process.platform === 'win32') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch(
    'enable-features',
    'WebRtcAllowWgcWindowCapturer,MediaFoundationVideoEncodeAccelerator,WebRtcAV1HWEncode'
  )
  app.commandLine.appendSwitch('disable-features', 'D3D12VideoEncodeAccelerator')
} else {
  app.commandLine.appendSwitch('enable-features', 'WebRtcAllowWgcWindowCapturer')
}

const AUTH_DEEP_LINK_SCHEME = 'mamacovoip'
if (process.defaultApp && process.argv.length >= 2) {
  if (!app.isDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])) {
    app.setAsDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  }
} else if (!app.isDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME)) {
  app.setAsDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME)
}

const MAX_AUTH_DEEP_LINK_LENGTH = 8192
function isValidAuthDeepLink(url) {
  if (typeof url !== 'string' || url.length > MAX_AUTH_DEEP_LINK_LENGTH) return false
  if (!url.toLowerCase().startsWith(`${AUTH_DEEP_LINK_SCHEME}://`)) return false
  try {
    return new URL(url).protocol === `${AUTH_DEEP_LINK_SCHEME}:`
  } catch {
    return false
  }
}

function findAuthDeepLinkInArgv(argv) {
  return (argv || []).find((arg) => isValidAuthDeepLink(arg)) ?? null
}

let pendingAuthDeepLink = findAuthDeepLinkInArgv(process.argv)

function handleAuthDeepLink(url) {
  if (!isValidAuthDeepLink(url)) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingAuthDeepLink = url
    return
  }
  sendToMain('google-auth-callback', url)
  if (mainWindow.isMinimized()) mainWindow.restore()
  forceFocusMainWindow()
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleAuthDeepLink(url)
})

let uIOhook = null
let UiohookKey = null
let uiohookAvailable = null

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

const fs = require('node:fs')
const debugLogPath = path.join(app.getPath('userData'), 'mamacos-debug.log')
const DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024
const DEBUG_LOG_MAX_LINE = 8000
let debugLogQueue = []
let debugLogFlushing = false
let debugLogSize = -1

function formatDebugLogLine(source, message) {
  let text = typeof message === 'string' ? message : String(message)
  if (text.length > DEBUG_LOG_MAX_LINE) text = `${text.slice(0, DEBUG_LOG_MAX_LINE)}… (truncado)`
  return `[${new Date().toISOString()}] [${source}] ${text}\n`
}

async function flushDebugLog() {
  if (debugLogFlushing) return
  debugLogFlushing = true
  try {
    while (debugLogQueue.length > 0) {
      const chunk = debugLogQueue.join('')
      debugLogQueue = []
      const chunkBytes = Buffer.byteLength(chunk)
      if (debugLogSize < 0) {
        try {
          debugLogSize = (await fs.promises.stat(debugLogPath)).size
        } catch {
          debugLogSize = 0
        }
      }
      if (debugLogSize + chunkBytes > DEBUG_LOG_MAX_BYTES) {
        try {
          await fs.promises.rename(debugLogPath, `${debugLogPath}.1`)
        } catch {
        }
        debugLogSize = 0
      }
      try {
        await fs.promises.appendFile(debugLogPath, chunk)
        debugLogSize += chunkBytes
      } catch {
      }
    }
  } finally {
    debugLogFlushing = false
  }
}

function appendDebugLog(source, message) {
  debugLogQueue.push(formatDebugLogLine(source, message))
  void flushDebugLog()
}

function flushDebugLogSync() {
  if (debugLogQueue.length === 0) return
  const chunk = debugLogQueue.join('')
  debugLogQueue = []
  try {
    fs.appendFileSync(debugLogPath, chunk)
  } catch {
  }
}

app.on('child-process-gone', (_event, details) => {
  appendDebugLog(
    'main',
    `child-process-gone: type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode}` +
      `${details?.serviceName ? ` service=${details.serviceName}` : ''}${details?.name ? ` name=${details.name}` : ''}`
  )
  if (details?.type === 'GPU' && details?.reason !== 'clean-exit' && preferGpuEncodeAtStartup) {
    gpuCrashCount++
    if (gpuCrashCount >= 2 && !gpuFallbackSaved) {
      gpuFallbackSaved = true
      try {
        fs.writeFileSync(videoEncodeSettingsPath(), JSON.stringify({ preferGpu: false, forceGpu: false, autoDisabled: true }))
      } catch {
        gpuFallbackSaved = false
      }
      appendDebugLog('main', 'video: placa de vídeo instável — modo GPU desligado automaticamente pra próxima abertura')
      sendToMain('video:gpu-auto-disabled')
    }
  }
})
let gpuCrashCount = 0
let gpuFallbackSaved = false

process.on('uncaughtException', (err) => {
  console.error('Erro não tratado no processo principal:', err)
  appendDebugLog('main:uncaughtException', `${err?.message ?? err}\n${err?.stack ?? ''}`)
})

process.on('unhandledRejection', (reason) => {
  console.error('Promise rejeitada sem tratamento no processo principal:', reason)
  const detail = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)
  appendDebugLog('main:unhandledRejection', detail)
})

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const DIST_DIR = path.join(__dirname, '..', 'dist')

const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://*.sslip.io wss://*.sslip.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src https://www.youtube.com https://clips.twitch.tv",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const DEV_SERVER_ORIGIN = (() => {
  try {
    return new URL(DEV_SERVER_URL).origin
  } catch {
    return 'http://localhost:5173'
  }
})()

const PUBLIC_WEB_ORIGIN = 'https://mamaco-voip.vercel.app'

function isVideoEmbedOrigin(url) {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (hostname === 'www.youtube.com' || hostname === 'clips.twitch.tv')
  } catch {
    return false
  }
}

function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url)
    if (isDev) return parsed.origin === DEV_SERVER_ORIGIN
    return parsed.protocol === 'app:' && parsed.host === 'bundle'
  } catch {
    return false
  }
}

function sendToMain(channel, ...args) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const contents = mainWindow.webContents
  if (!contents || contents.isDestroyed()) return
  try {
    contents.send(channel, ...args)
  } catch {
  }
}

function isTrustedIpcSender(event) {
  const frame = event?.senderFrame
  if (!frame) return false
  if (frame.parent) return false
  return isAllowedNavigation(frame.url)
}

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      appendDebugLog('main', `IPC recusado (remetente não confiável) em ${channel}`)
      throw new Error('Remetente não autorizado')
    }
    return handler(event, ...args)
  })
}

function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      appendDebugLog('main', `IPC recusado (remetente não confiável) em ${channel}`)
      return
    }
    listener(event, ...args)
  })
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
function openExternalSafely(url) {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      appendDebugLog('main', `openExternalSafely: bloqueado protocolo não permitido (${parsed.protocol}) — url=${url}`)
      return
    }
    shell.openExternal(parsed.toString()).catch((err) => {
      appendDebugLog('main', `openExternalSafely: falha ao abrir — ${err?.message ?? err}`)
    })
  } catch {
  }
}

const win32native = require('./win32native.cjs')
const gameCatalog = require('./gameCatalog.cjs')
const KNOWN_GAMES = gameCatalog.buildKnownGamesMap()

const GAME_CHECK_INTERVAL_MS = 15_000
const FOREGROUND_CHECK_INTERVAL_MS = 3_000

let mainWindow = null
let isQuitting = false
let updateReadyToInstall = false
let gameCheckTimer = null
let foregroundCheckTimer = null
let foregroundCheckInFlight = false
let currentGame = null
let lastForegroundApp = null
let genericDetectedGame = null
let watchedProcessNames = []
let watchedProcessWasSeen = false
let gameWindowMissStreak = 0
let gameCheckTickCount = 0

function getRunningProcessSnapshot() {
  if (process.platform === 'win32') {
    const procs = win32native.listProcesses()
    if (procs) {
      const names = new Set(procs.map((p) => `${p.name}.exe`))
      return Promise.resolve({ text: '', names, isWin: true })
    }
  }
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const [file, args] = isWin
      ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe'), ['/fo', 'csv', '/nh']]
      : ['ps', process.platform === 'darwin' ? ['-Ao', 'comm'] : ['-eo', 'comm']]

    execFile(file, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null)
        return
      }
      const text = stdout.toLowerCase()
      const names = new Set()
      if (isWin) {
        for (const line of text.split(/\r?\n/)) {
          const match = /^"([^"]+)"/.exec(line)
          if (match) names.add(match[1])
        }
      }
      resolve({ text, names, isWin })
    })
  })
}

function snapshotHasProcess(snapshot, name) {
  if (!snapshot || !name) return false
  const lower = String(name).toLowerCase()
  if (snapshot.isWin) {
    return snapshot.names.has(lower) || snapshot.names.has(`${lower}.exe`)
  }
  return snapshot.text.includes(lower)
}

function detectRunningGameFromSnapshot(snapshot) {
  if (!snapshot) return null
  for (const [processName, label] of Object.entries(KNOWN_GAMES)) {
    if (snapshotHasProcess(snapshot, processName)) return label
  }
  return null
}

let gameCheckInFlight = false

function startGameDetection() {
  if (gameCheckTimer) return
  gameCheckTimer = setInterval(async () => {
    if (gameCheckInFlight) return
    gameCheckInFlight = true
    try {
      await runGameCheckTick()
    } catch (err) {
      appendDebugLog('main', `startGameDetection: falha na verificação — ${err?.message ?? err}`)
    } finally {
      gameCheckInFlight = false
    }
  }, GAME_CHECK_INTERVAL_MS)

  if (foregroundCheckTimer) return
  foregroundCheckTimer = setInterval(runForegroundCheckTick, FOREGROUND_CHECK_INTERVAL_MS)
}

async function runGameCheckTick() {
    gameCheckTickCount++
    const snapshot = await getRunningProcessSnapshot()
    if (!snapshot) return

    let game = detectRunningGameFromSnapshot(snapshot)
    if (!game && genericDetectedGame) {
      if (genericDetectedGame.processNames.some((n) => snapshotHasProcess(snapshot, n))) {
        game = genericDetectedGame.label
      } else {
        appendDebugLog('main', `detecção genérica: "${genericDetectedGame.label}" fechou`)
        genericDetectedGame = null
      }
    }

    if (game && process.platform === 'win32') {
      const justChanged = game !== currentGame
      const periodicRecheck = gameCheckTickCount % 4 === 0
      if (justChanged || periodicRecheck) {
        const info = await getGameWindowInfo(processNamesForGameLabel(game))
        if (info) {
          gameWindowMissStreak = 0
        } else {
          if (justChanged) appendDebugLog('main', `detecção: processo de "${game}" rodando, mas sem janela do jogo ainda`)
          gameWindowMissStreak++
          if (justChanged || gameWindowMissStreak >= 2) {
            game = null
          }
        }
      }
    } else {
      gameWindowMissStreak = 0
    }

    if (game !== currentGame) {
      const gameClosed = currentGame !== null && game === null
      appendDebugLog('main', game ? `detecção: jogando "${game}"` : `detecção: jogo "${currentGame}" fechou`)
      currentGame = game
      sendToMain('game-status-changed', game)
      if (gameClosed && overlayVisible) {
        appendDebugLog('main', 'overlay: jogo fechou — desligando a sobreposição')
        setOverlayVisible(false)
      }
    }

    if (watchedProcessNames.length > 0 && snapshot) {
      const stillRunning = watchedProcessNames.some((name) => snapshotHasProcess(snapshot, name))
      if (stillRunning) {
        watchedProcessWasSeen = true
      } else if (watchedProcessWasSeen) {
        watchedProcessNames = []
        watchedProcessWasSeen = false
        sendToMain('watched-process-exited')
      }
    }
}

async function runForegroundCheckTick() {
    if (foregroundCheckInFlight) return
    if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
      foregroundCheckInFlight = true
      try {
        const fg = await getForegroundWindowInfo()
        if (fg && fg.pid !== process.pid && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          lastForegroundApp = fg
          const generic = gameCatalog.detectGenericGameFromPath(fg.exePath)
          if (generic && !gameCatalog.findGameByProcessName(generic.processName)) {
            if (!genericDetectedGame || genericDetectedGame.label !== generic.label) {
              appendDebugLog('main', `detecção genérica: "${generic.label}" (${generic.store}, ${generic.processName}.exe)`)
            }
            const steam = generic.store === 'Steam' ? steamInfoForExePath(fg.exePath) : null
            genericDetectedGame = {
              label: steam?.name || generic.label,
              processNames: [generic.processName],
              antiCheat: generic.antiCheat,
              store: generic.store,
              steamAppId: steam?.appId ?? null,
            }
          }
        }
      } finally {
        foregroundCheckInFlight = false
      }
    }
}

function stopGameDetection() {
  if (gameCheckTimer) clearInterval(gameCheckTimer)
  if (foregroundCheckTimer) clearInterval(foregroundCheckTimer)
  gameCheckTimer = null
  foregroundCheckTimer = null
}

function privacySettingsPath() {
  return path.join(app.getPath('userData'), 'privacy-settings.json')
}

function isGameDetectionEnabled() {
  try {
    const raw = JSON.parse(fs.readFileSync(privacySettingsPath(), 'utf8'))
    return raw?.gameDetection !== false
  } catch {
    return true
  }
}

function setGameDetectionEnabled(enabled) {
  try {
    fs.writeFileSync(privacySettingsPath(), JSON.stringify({ gameDetection: !!enabled }))
  } catch (err) {
    appendDebugLog('main', `privacidade: falha ao salvar — ${err?.message ?? err}`)
  }
  if (enabled) {
    startGameDetection()
  } else {
    stopGameDetection()
    genericDetectedGame = null
    lastForegroundApp = null
    if (currentGame !== null) {
      currentGame = null
      sendToMain('game-status-changed', null)
    }
  }
  return !!enabled
}

let foregroundWatcherProc = null
let foregroundWatcherGames = []

function processNamesForGameLabel(label) {
  const names = Object.entries(KNOWN_GAMES)
    .filter(([, gameLabel]) => gameLabel === label)
    .map(([processName]) => processName.replace(/\.exe$/i, ''))
  if (names.length === 0 && genericDetectedGame && genericDetectedGame.label === label) {
    return genericDetectedGame.processNames.slice()
  }
  return names
}

const STEAM_APP_IDS = {
  'Counter-Strike 2': 730, 'Rainbow Six Siege X': 359550, 'Apex Legends': 1172470, 'Marvel Rivals': 2767030,
  'Battlefield 2042': 1517290, 'PUBG: Battlegrounds': 578080, 'The Finals': 2073850, 'Destiny 2': 1085660,
  'Team Fortress 2': 440, 'Halo Infinite': 1240440, 'Among Us': 945360, 'Fall Guys': 1097150,
  'Lethal Company': 1966720, 'Phasmophobia': 739630, 'Dota 2': 570, 'Deadlock': 1422450, 'GTA V': 271590,
  'Red Dead Redemption 2': 1174180, 'Elden Ring': 1245620, 'Cyberpunk 2077': 1091500, 'The Witcher 3': 292030,
  'Skyrim': 489830, 'Starfield': 1716740, 'Hogwarts Legacy': 990080, 'Black Myth: Wukong': 2358720,
  'Kingdom Come: Deliverance II': 1771300, 'Warframe': 230410, 'Terraria': 105600, 'Rust': 252490, 'DayZ': 221100,
  'ARK: Survival Evolved': 346110, 'Valheim': 892970, 'Palworld': 1623730, '7 Days to Die': 251570,
  'Stardew Valley': 413150, 'Assetto Corsa': 244210, 'Forza Horizon 5': 1551360, 'Sea of Thieves': 1172620,
  'Lost Ark': 1599340, 'Albion Online': 761890, 'Helldivers 2': 553850, 'Monster Hunter Wilds': 2246340,
  'Path of Exile 2': 2694490, 'R.E.P.O.': 3241660, 'Hollow Knight: Silksong': 1030300,
}
const steamManifestCache = new Map()
function steamInfoForExePath(exePath) {
  if (!exePath) return null
  const m = /^(.*[\\/]steamapps)[\\/]common[\\/]([^\\/]+)[\\/]/i.exec(exePath)
  if (!m) return null
  const [, steamapps, folder] = m
  const key = `${steamapps}|${folder}`.toLowerCase()
  if (steamManifestCache.has(key)) return steamManifestCache.get(key)
  let found = null
  try {
    for (const file of fs.readdirSync(steamapps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue
      const txt = fs.readFileSync(path.join(steamapps, file), 'utf8').slice(0, 20000)
      const dir = /"installdir"\s+"([^"]+)"/i.exec(txt)?.[1]
      if (!dir || dir.toLowerCase() !== folder.toLowerCase()) continue
      const appId = Number(/"appid"\s+"(\d+)"/i.exec(txt)?.[1])
      const name = /"name"\s+"([^"]+)"/i.exec(txt)?.[1] ?? null
      if (appId > 0) found = { appId, name: name ? name.slice(0, 120) : null }
      break
    }
  } catch {
  }
  steamManifestCache.set(key, found)
  return found
}

function antiCheatForGameLabel(label) {
  if (!label) return null
  const entry = gameCatalog.findGameByName(label)
  if (entry) return gameCatalog.antiCheatLabel(entry.antiCheat)
  if (genericDetectedGame && genericDetectedGame.label === label) return gameCatalog.antiCheatLabel(genericDetectedGame.antiCheat)
  return null
}

function ensureScanner() {
  return win32native.available()
}

function isCatalogProcess(baseName) {
  return Boolean(gameCatalog.findGameByProcessName(baseName))
}

function physicalToDip(rect) {
  if (!rect) return null
  try {
    return screen.screenToDipRect(null, rect)
  } catch {
    return rect
  }
}

function getGameWindowInfo(processNames) {
  if (process.platform !== 'win32' || !processNames || processNames.length === 0) return Promise.resolve(null)
  try {
    const r = win32native.findLargestWindowForProcessNames(processNames)
    if (!r || !(r.pid > 0)) return Promise.resolve(null)
    return Promise.resolve({
      bounds: physicalToDip(r.monitor),
      windowTitle: r.title || null,
      pid: r.pid,
      hwnd: r.hwnd > 0 ? r.hwnd : null,
      isMinimized: r.showCmd === 2,
    })
  } catch {
    return Promise.resolve(null)
  }
}

function getForegroundWindowInfo() {
  if (process.platform !== 'win32') return Promise.resolve(null)
  try {
    const r = win32native.foregroundWindow()
    if (!r || !(r.pid > 0)) return Promise.resolve(null)
    return Promise.resolve({
      bounds: physicalToDip(r.monitor),
      windowTitle: r.title || null,
      processName: r.processName || null,
      pid: r.pid,
      exePath: win32native.processImagePath(r.pid, r.processName, isCatalogProcess),
    })
  } catch {
    return Promise.resolve(null)
  }
}

function getWindowPidMap() {
  if (process.platform !== 'win32') return Promise.resolve(new Map())
  try {
    return Promise.resolve(win32native.titlePidMap())
  } catch {
    return Promise.resolve(new Map())
  }
}

function parseHwndFromSourceId(id) {
  const match = /^window:(\d+):/.exec(id || '')
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function getPidsForWindowHandles(hwnds) {
  if (process.platform !== 'win32' || !hwnds || hwnds.length === 0) return Promise.resolve(new Map())
  try {
    return Promise.resolve(win32native.pidsForWindowHandles(hwnds))
  } catch {
    return Promise.resolve(new Map())
  }
}

function matchDisplayIdForBounds(bounds) {
  if (!bounds) return null
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const match = screen.getAllDisplays().find((d) => {
    const b = d.bounds
    return centerX >= b.x && centerX < b.x + b.width && centerY >= b.y && centerY < b.y + b.height
  })
  return match ? String(match.id) : null
}

function startForegroundWatch(processNames) {
  stopForegroundWatch()
  if (process.platform !== 'win32') return false

  foregroundWatcherGames = (Array.isArray(processNames) ? processNames : [])
    .slice(0, 32)
    .map((n) => String(n).toLowerCase())
    .filter(Boolean)
  if (foregroundWatcherGames.length === 0) return false

  let lastFocused = null
  const timer = setInterval(() => {
    let name = null
    try {
      name = win32native.foregroundProcessName()
    } catch {
      name = null
    }
    if (name === null) return
    const isFocused = foregroundWatcherGames.some((g) => name === g)
    if (isFocused !== lastFocused) {
      lastFocused = isFocused
      sendToMain('game-foreground-changed', isFocused)
    }
  }, 700)
  foregroundWatcherProc = { kill: () => clearInterval(timer) }
  return true
}

function stopForegroundWatch() {
  if (foregroundWatcherProc) {
    try {
      foregroundWatcherProc.kill()
    } catch {
    }
    foregroundWatcherProc = null
  }
  foregroundWatcherGames = []
}

let startupSplash = null
let resolveStartupGate = () => {}
let startupGatePending = false
let startupUpdating = false
const startupUpdateGate = new Promise((resolve) => {
  resolveStartupGate = () => {
    startupGatePending = false
    resolve()
  }
})
function releaseStartupGate() {
  startupUpdating = false
  resolveStartupGate()
}
function closeStartupSplash() {
  if (startupSplash && !startupSplash.isDestroyed()) startupSplash.close()
  startupSplash = null
}
function showStartupUpdating(percent) {
  if (!startupSplash || startupSplash.isDestroyed()) startupSplash = createSplashWindow()
  const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : -1
  const run = () => {
    if (!startupSplash || startupSplash.isDestroyed()) return
    startupSplash.webContents
      .executeJavaScript(`window.mvSetUpdating && window.mvSetUpdating(${pct})`, true)
      .catch(() => {})
  }
  if (startupSplash.webContents.isLoading()) startupSplash.webContents.once('did-finish-load', run)
  else run()
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
let overlayTopmostTimer = null

const OVERLAY_WIDTH = 240
const OVERLAY_HEIGHT = 420
const OVERLAY_MARGIN = 24
const OVERLAY_CORNERS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
let overlaySettingsCache = null

const TITLEBAR_HEX = /^#[0-9a-f]{6}$/i
function titleBarColorsPath() {
  return path.join(app.getPath('userData'), 'titlebar-colors.json')
}
function loadTitleBarColors() {
  const fallback = { color: '#0d0d12', symbolColor: '#f3efee' }
  try {
    const raw = JSON.parse(fs.readFileSync(titleBarColorsPath(), 'utf8'))
    return {
      color: TITLEBAR_HEX.test(raw?.color) ? raw.color : fallback.color,
      symbolColor: TITLEBAR_HEX.test(raw?.symbolColor) ? raw.symbolColor : fallback.symbolColor,
    }
  } catch {
    return fallback
  }
}

function overlaySettingsPath() {
  return path.join(app.getPath('userData'), 'overlay-settings.json')
}

function loadOverlaySettings() {
  if (overlaySettingsCache) return overlaySettingsCache
  let corner = 'top-left'
  let opacity = 60
  try {
    const raw = JSON.parse(fs.readFileSync(overlaySettingsPath(), 'utf8'))
    if (raw && OVERLAY_CORNERS.has(raw.corner)) corner = raw.corner
    if (raw && Number.isFinite(raw.opacity)) opacity = Math.max(20, Math.min(100, Math.round(raw.opacity)))
  } catch {
  }
  overlaySettingsCache = { corner, opacity }
  return overlaySettingsCache
}

function saveOverlaySettings(next) {
  overlaySettingsCache = next
  try {
    fs.writeFileSync(overlaySettingsPath(), JSON.stringify(next))
  } catch (err) {
    appendDebugLog('main', `overlay: falha ao salvar configurações — ${err?.message ?? err}`)
  }
}

function overlayTargetDisplay() {
  try {
    const b = lastForegroundApp?.bounds
    if (b && b.width > 0 && b.height > 0) return screen.getDisplayMatching(b)
  } catch {
  }
  return screen.getPrimaryDisplay()
}

function overlayBoundsFor(corner) {
  const area = overlayTargetDisplay().workArea
  const left = area.x + OVERLAY_MARGIN
  const right = area.x + area.width - OVERLAY_WIDTH - OVERLAY_MARGIN
  const top = area.y + OVERLAY_MARGIN
  const bottom = area.y + area.height - OVERLAY_HEIGHT - OVERLAY_MARGIN
  return {
    x: Math.round(corner.endsWith('right') ? right : left),
    y: Math.round(corner.startsWith('bottom') ? bottom : top),
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
  }
}

function applyOverlayPlacement(overlay) {
  if (!overlay || overlay.isDestroyed()) return
  const { corner } = loadOverlaySettings()
  overlay.setBounds(overlayBoundsFor(corner))
  if (!overlay.webContents.isLoading()) overlay.webContents.send('overlay:settings', loadOverlaySettings())
}

function createOverlayWindow() {
  const { corner } = loadOverlaySettings()
  const overlay = new BrowserWindow({
    ...overlayBoundsFor(corner),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setIgnoreMouseEvents(true)
  try {
    overlay.setContentProtection(true)
  } catch {
  }
  overlay.loadFile(path.join(__dirname, 'overlay.html'))
  overlay.webContents.on('did-finish-load', () => {
    if (overlay.isDestroyed()) return
    overlay.webContents.send('overlay:settings', loadOverlaySettings())
    if (lastOverlayState !== null) {
      overlay.webContents.send('overlay:voice-state', lastOverlayState)
    }
  })
  overlay.on('closed', () => {
    if (overlayWindow === overlay) {
      overlayWindow = null
      overlayVisible = false
      stopOverlayTopmostKeeper()
    }
  })
  return overlay
}

function startOverlayTopmostKeeper() {
  stopOverlayTopmostKeeper()
  overlayTopmostTimer = setInterval(() => {
    if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed()) return
    try {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
      overlayWindow.moveTop()
    } catch {
    }
  }, 4000)
}

function stopOverlayTopmostKeeper() {
  if (overlayTopmostTimer) clearInterval(overlayTopmostTimer)
  overlayTopmostTimer = null
}

let overlayNoticeUntil = 0
let overlayNoticeTimer = null

function overlayShouldBeOnScreen() {
  return overlayVisible && (Boolean(lastOverlayState?.connected) || Date.now() < overlayNoticeUntil)
}

function syncOverlayWindow() {
  if (overlayShouldBeOnScreen()) {
    const overlay = ensureOverlayWindow()
    applyOverlayPlacement(overlay)
    if (!overlay.webContents.isLoading() && lastOverlayState !== null) {
      overlay.webContents.send('overlay:voice-state', lastOverlayState)
    }
    if (!overlay.isVisible()) overlay.showInactive()
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.moveTop()
    if (!overlayTopmostTimer) startOverlayTopmostKeeper()
  } else {
    stopOverlayTopmostKeeper()
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) overlayWindow.hide()
  }
}

function setOverlayVisible(visible) {
  overlayVisible = Boolean(visible)
  if (overlayNoticeTimer) clearTimeout(overlayNoticeTimer)
  overlayNoticeTimer = null
  if (overlayVisible) {
    overlayNoticeUntil = Date.now() + 5000
    syncOverlayWindow()
    const overlay = overlayWindow
    if (overlay && !overlay.isDestroyed()) {
      if (!overlay.webContents.isLoading()) overlay.webContents.send('overlay:shown')
      else overlay.webContents.once('did-finish-load', () => overlay.isDestroyed() || overlay.webContents.send('overlay:shown'))
    }
    overlayNoticeTimer = setTimeout(() => {
      overlayNoticeTimer = null
      overlayNoticeUntil = 0
      syncOverlayWindow()
    }, 5100)
  } else {
    overlayNoticeUntil = 0
    syncOverlayWindow()
  }
  appendDebugLog('main', `overlay: ${overlayVisible ? 'ligada' : 'desligada'} (canto=${loadOverlaySettings().corner})`)
  sendToMain('overlay:visibility-changed', overlayVisible)
}

let lastOverlayState = null

function ensureOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow()
  }
  return overlayWindow
}

function autoStartSettingsPath() {
  return path.join(app.getPath('userData'), 'autostart-settings.json')
}
function setAutoStart(enabled) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false
  if (!app.isPackaged) return false
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--mv-autostart'] })
    fs.writeFileSync(autoStartSettingsPath(), JSON.stringify({ enabled: Boolean(enabled) }))
  } catch (err) {
    appendDebugLog('main', `autostart: falha — ${err?.message ?? err}`)
  }
  return getAutoStart()
}
function getAutoStart() {
  try {
    return app.getLoginItemSettings({ args: ['--mv-autostart'] }).openAtLogin === true
  } catch {
    return false
  }
}
function applyAutoStartDefault() {
  if (!app.isPackaged) return
  if (fs.existsSync(autoStartSettingsPath())) return
  setAutoStart(true)
}

function forceFocusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(false)
}

function scheduleFocusReclaim() {
  ;[150, 500, 1000].forEach((delay) => setTimeout(forceFocusMainWindow, delay))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...loadTitleBarColors(),
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
    autoHideMenuBar: true,
  })

  if (isDev) {
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadURL('app://bundle/index.html')
  }

  const devToolsAllowed =
    isDev || process.argv.includes('--devtools') || process.env.MAMACOS_DEVTOOLS === '1'
  win.webContents.on('before-input-event', (_event, input) => {
    if (!devToolsAllowed) return
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return
    if (!isMainFrame) return
    dialog.showErrorBox(
      'Mamacos Voip — falha ao carregar',
      `Código: ${errorCode}\nDescrição: ${errorDescription}\nCaminho: ${validatedURL}`,
    )
  })

  const RENDERER_CRASH_WINDOW_MS = 2 * 60 * 1000
  const RENDERER_MAX_RECOVERIES = 3
  let rendererCrashTimes = []
  win.webContents.on('render-process-gone', (_event, details) => {
    appendDebugLog('main', `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    rendererCrashTimes = rendererCrashTimes.filter((t) => now - t < RENDERER_CRASH_WINDOW_MS)
    rendererCrashTimes.push(now)
    if (win.isDestroyed()) return
    if (rendererCrashTimes.length > RENDERER_MAX_RECOVERIES) {
      appendDebugLog('main', `render-process-gone: ${rendererCrashTimes.length} travamentos em menos de 2 min — desistindo de recarregar sozinho`)
      flushDebugLogSync()
      dialog.showErrorBox(
        'Mamacos Voip — processo travou',
        `Motivo: ${details.reason}\n\nO app travou várias vezes seguidas. Feche e abra de novo pela bandeja. ` +
          `Se continuar, envie o arquivo de log:\n${debugLogPath}`
      )
      return
    }
    appendDebugLog('main', `render-process-gone: recarregando a página automaticamente (tentativa ${rendererCrashTimes.length}/${RENDERER_MAX_RECOVERIES})`)
    try {
      win.webContents.reload()
    } catch (err) {
      appendDebugLog('main', `render-process-gone: reload falhou — ${err?.message}`)
    }
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Mamacos Voip se recuperou de um travamento',
          body: 'O app recarregou sozinho (você saiu da call). Se aconteceu ao compartilhar a tela, tente de novo com uma qualidade menor.',
          silent: true,
        }).show()
      }
    } catch {
    }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
      openExternalSafely(url)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  win.on('minimize', (event) => {
    event.preventDefault()
    win.hide()
  })
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('session-end', () => {
    isQuitting = true
  })

  win.on('focus', () => {
    try {
      win.flashFrame(false)
    } catch {
    }
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

  tray.on('click', () => {
    if (win.isVisible()) {
      win.focus()
    } else {
      win.show()
      win.focus()
    }
  })
}

const SECURE_STORAGE_FILE = 'secure-session.json'
const SECURE_STORAGE_KEY_PATTERN = /^(?:sb-[A-Za-z0-9._-]{1,200}|mv-user-notes)$/
const SECURE_STORAGE_MAX_VALUE = 512 * 1024
let secureStoreCache = null

function isValidSecureStorageKey(key) {
  return typeof key === 'string' && SECURE_STORAGE_KEY_PATTERN.test(key)
}

function isSecureStorageAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text'
    }
    return true
  } catch {
    return false
  }
}

function secureStorePath() {
  return path.join(app.getPath('userData'), SECURE_STORAGE_FILE)
}

function loadSecureStore() {
  if (secureStoreCache) return secureStoreCache
  let parsed = {}
  try {
    const raw = fs.readFileSync(secureStorePath(), 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data)) {
        if (isValidSecureStorageKey(k) && typeof v === 'string') parsed[k] = v
      }
    }
  } catch {
    parsed = {}
  }
  secureStoreCache = parsed
  return secureStoreCache
}

function persistSecureStore() {
  const target = secureStorePath()
  const tmp = `${target}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(secureStoreCache ?? {}), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(tmp, target)
    return true
  } catch (err) {
    appendDebugLog('main', `secure-storage: falha ao gravar: ${err?.message ?? err}`)
    return false
  }
}

app.on('second-instance', (_event, argv) => {
  const deepLink = findAuthDeepLinkInArgv(argv)
  if (deepLink) handleAuthDeepLink(deepLink)

  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  forceFocusMainWindow()
})

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.mamacosvoip.app')
  if (process.platform === 'win32') {
    const ok = win32native.available()
    appendDebugLog('main', `win32native: ${ok ? 'ok' : `FALHOU — ${win32native.loadErrorMessage()}`}; detecção de jogos ${isGameDetectionEnabled() ? 'ligada' : 'DESLIGADA (privacidade)'}`)
  }
  if (!isDev) {
    protocol.handle('app', async (request) => {
      let pathname
      try {
        const parsedUrl = new URL(request.url)
        if (parsedUrl.host !== 'bundle') return new Response('Not Found', { status: 404 })
        pathname = decodeURIComponent(parsedUrl.pathname)
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
      if (pathname === '' || pathname === '/') pathname = '/index.html'
      const filePath = path.join(DIST_DIR, pathname)

      const relative = path.relative(DIST_DIR, filePath)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || filePath.includes('\0')) {
        return new Response('Forbidden', { status: 403 })
      }
      const response = await net.fetch(pathToFileURL(filePath).toString())
      if (!/\.html?$/i.test(filePath)) return response
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY)
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    })
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = ['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']
    let requestingUrl = ''
    try {
      requestingUrl = details?.requestingUrl || webContents?.getURL() || ''
    } catch {
      requestingUrl = ''
    }
    if (permission === 'fullscreen' && isVideoEmbedOrigin(requestingUrl)) {
      callback(true)
      return
    }
    callback(allowed.includes(permission) && isAllowedNavigation(requestingUrl))
  })

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      if (!headers.Referer && !headers.referer) headers.Referer = `${PUBLIC_WEB_ORIGIN}/`
      callback({ requestHeaders: headers })
    }
  )

  handleTrusted('screen-share:get-sources', async () => {
    try {
      let runningCatalogGame = null
      if (!currentGame && isGameDetectionEnabled()) {
        try {
          runningCatalogGame = detectRunningGameFromSnapshot(await getRunningProcessSnapshot())
        } catch {
          runningCatalogGame = null
        }
      }
      const gameLabelAtOpen = currentGame ?? runningCatalogGame
      const capped = (promise, fallback) =>
        Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), 2500))])
      const gameInfoPromise = gameLabelAtOpen
        ? capped(getGameWindowInfo(processNamesForGameLabel(gameLabelAtOpen)), null)
        : Promise.resolve(null)
      const titlePidMapPromise = capped(getWindowPidMap(), new Map())
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: false,
      })
      let primaryDisplayId = null
      try {
        primaryDisplayId = String(screen.getPrimaryDisplay().id)
      } catch {
      }
      let windowInfo = null
      let isKnownGame = false
      let suggestionLabel = null
      let watchProcessNamesForShare = []

      if (gameLabelAtOpen) {
        const info = await gameInfoPromise
        if (info) {
          windowInfo = info
          isKnownGame = true
          suggestionLabel = gameLabelAtOpen
          watchProcessNamesForShare = processNamesForGameLabel(gameLabelAtOpen)
        }
      }
      if (!windowInfo && lastForegroundApp) {
        windowInfo = lastForegroundApp
        isKnownGame = false
        suggestionLabel = lastForegroundApp.windowTitle || lastForegroundApp.processName
        watchProcessNamesForShare = lastForegroundApp.processName ? [lastForegroundApp.processName] : []
      }

      const windowHwnds = sources
        .filter((s) => s.id.startsWith('window:'))
        .map((s) => parseHwndFromSourceId(s.id))
        .filter((h) => h !== null)
      const [hwndPidMap, titlePidMap] = await Promise.all([capped(getPidsForWindowHandles(windowHwnds), new Map()), titlePidMapPromise])

      let gameDisplayId = matchDisplayIdForBounds(windowInfo?.bounds ?? null)
      const screenSources = sources.filter((s) => s.id.startsWith('screen:'))
      if (!gameDisplayId && gameLabelAtOpen && screenSources.length === 1) {
        gameDisplayId = screenSources[0].display_id
        isKnownGame = true
        suggestionLabel = gameLabelAtOpen
        if (watchProcessNamesForShare.length === 0) {
          watchProcessNamesForShare = processNamesForGameLabel(gameLabelAtOpen)
        }
      }
      if (!gameDisplayId && gameLabelAtOpen && primaryDisplayId) {
        gameDisplayId = primaryDisplayId
        isKnownGame = true
        suggestionLabel = gameLabelAtOpen
        if (watchProcessNamesForShare.length === 0) {
          watchProcessNamesForShare = processNamesForGameLabel(gameLabelAtOpen)
        }
      }
      const gameWindowTitle = windowInfo?.windowTitle ?? null
      const gameWindowPid = windowInfo?.pid ?? null
      const resolvedPidBySourceId = new Map(
        sources
          .filter((s) => s.id.startsWith('window:'))
          .map((s) => [s.id, hwndPidMap.get(parseHwndFromSourceId(s.id)) ?? titlePidMap.get(s.name) ?? null])
      )
      const gameWindowHwnd = windowInfo?.hwnd ?? null
      const hasCapturableGameWindow =
        gameWindowPid !== null &&
        sources.some((s) => s.id.startsWith('window:') && resolvedPidBySourceId.get(s.id) === gameWindowPid)
      appendDebugLog(
        'main',
        `seletor de tela: ${sources.length} fontes (${sources.filter((s) => s.id.startsWith('window:')).length} janelas), ` +
          `jogo detectado=${gameLabelAtOpen ?? 'nenhum'}, janela do jogo=${windowInfo?.pid ? `pid ${windowInfo.pid}` : 'não achada'}, ` +
          `sugestão=${suggestionLabel ?? 'nenhuma'}, win32=${win32native.available() ? 'ok' : 'FALHOU'}`
      )
      const looksMinimized =
        isKnownGame &&
        gameWindowHwnd !== null &&
        gameWindowPid !== null &&
        !hasCapturableGameWindow &&
        windowInfo?.isMinimized === true

      return {
        sources: sources.map((s) => {
          const pid = s.id.startsWith('window:') ? resolvedPidBySourceId.get(s.id) ?? null : null
          return {
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.isEmpty()
              ? ''
              : `data:image/jpeg;base64,${s.thumbnail.toJPEG(75).toString('base64')}`,
            type: s.id.startsWith('screen:') ? 'screen' : 'window',
            isPrimaryDisplay: Boolean(primaryDisplayId) && s.display_id === primaryDisplayId,
            isExactGameWindow:
              gameWindowPid !== null ? pid === gameWindowPid : Boolean(gameWindowTitle) && s.name === gameWindowTitle,
            isGameDisplay: Boolean(gameDisplayId) && s.display_id === gameDisplayId,
            pid,
          }
        }),
        suggestion: suggestionLabel
          ? {
              label: suggestionLabel,
              isKnownGame,
              processNames: watchProcessNamesForShare,
              pid: windowInfo?.pid ?? null,
              hwnd: gameWindowHwnd,
              looksMinimized,
              antiCheat: isKnownGame ? antiCheatForGameLabel(suggestionLabel) : null,
            }
          : null,
      }
    } catch {
      return null
    }
  })

  handleTrusted('clipboard:write-text', async (_event, text) => {
    if (typeof text !== 'string' || text.length > 100_000) return false
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  })

  handleTrusted('screen-share:select', (_event, sourceId) => {
    if (sourceId) scheduleFocusReclaim()
  })

  if (process.platform !== 'linux') {
  let fallbackPinnedSourceId = null
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    let responded = false
    const respond = (value) => {
      if (responded) return
      responded = true
      try {
        callback(value)
      } catch {
      }
    }
    try {
      let requestUrl = ''
      try {
        requestUrl = _request?.frame?.url || _request?.securityOrigin || ''
      } catch {
        requestUrl = _request?.securityOrigin || ''
      }
      if (!fallbackPinnedSourceId || !isAllowedNavigation(requestUrl)) {
        respond({})
        return
      }
      const wanted = fallbackPinnedSourceId
      fallbackPinnedSourceId = null
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const source = sources.find((s) => s.id === wanted)
      respond(source ? { video: source, audio: undefined } : {})
    } catch {
      respond({})
    }
  })

  handleTrusted('screen-share:pin-fallback-source', (_event, sourceId) => {
    fallbackPinnedSourceId = typeof sourceId === 'string' && sourceId.length < 256 ? sourceId : null
  })
  }

  onTrusted('app:focus-window', () => {
    scheduleFocusReclaim()
  })

  const liveNotifications = new Set()
  handleTrusted('notify:show', (_event, payload) => {
    if (!Notification.isSupported() || !payload || typeof payload !== 'object') return false
    const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
    const title = text(payload.title, 120)
    if (!title) return false
    const t = payload.target
    const target =
      t && typeof t === 'object' && ['dm', 'group', 'channel'].includes(t.kind) && typeof t.id === 'string' && t.id.length < 64
        ? { kind: t.kind, id: t.id, serverId: typeof t.serverId === 'string' && t.serverId.length < 64 ? t.serverId : undefined }
        : null
    try {
      const n = new Notification({
        title,
        body: text(payload.body, 240),
        silent: true,
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
      })
      liveNotifications.add(n)
      const forget = () => liveNotifications.delete(n)
      n.on('click', () => {
        forget()
        forceFocusMainWindow()
        if (target && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notify:clicked', target)
      })
      n.on('close', forget)
      setTimeout(forget, 10 * 60 * 1000)
      n.show()
      return true
    } catch {
      return false
    }
  })

  onTrusted('window:flash', () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return
    try {
      mainWindow.flashFrame(true)
    } catch {
    }
  })

  Menu.setApplicationMenu(null)

  const startedHidden = process.argv.includes('--mv-autostart')
  applyAutoStartDefault()
  if (isDev) releaseStartupGate()
  startupSplash = startedHidden ? null : createSplashWindow()
  const win = createWindow()
  createTray(win)

  win.once('ready-to-show', () => {
    void startupUpdateGate.then(() => {
      closeStartupSplash()
      if (!startedHidden) win.show()
    })
  })

  win.webContents.once('did-fail-load', () => {
    closeStartupSplash()
  })
  win.webContents.once('render-process-gone', () => {
    closeStartupSplash()
  })

  win.webContents.once('did-finish-load', () => {
    if (pendingAuthDeepLink) {
      const link = pendingAuthDeepLink
      pendingAuthDeepLink = null
      handleAuthDeepLink(link)
    }
  })

  onTrusted('overlay:update-state', (_event, state) => {
    const wasConnected = Boolean(lastOverlayState?.connected)
    lastOverlayState = state ?? null
    const isConnected = Boolean(lastOverlayState?.connected)
    if (overlayVisible && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay:voice-state', lastOverlayState)
    }
    if (wasConnected !== isConnected) syncOverlayWindow()
  })

  let registeredKeybinds = []
  handleTrusted('keybinds:set-global', (_event, list) => {
    for (const acc of registeredKeybinds) {
      try {
        globalShortcut.unregister(acc)
      } catch {
      }
    }
    registeredKeybinds = []
    const failed = []
    if (!Array.isArray(list)) return { failed }
    for (const item of list.slice(0, 32)) {
      const id = typeof item?.id === 'string' ? item.id.slice(0, 40) : ''
      const acc = typeof item?.accelerator === 'string' ? item.accelerator.slice(0, 60) : ''
      if (!id || !acc) continue
      try {
        const ok = globalShortcut.register(acc, () => sendToMain('keybind', id))
        if (ok) registeredKeybinds.push(acc)
        else failed.push(id)
      } catch {
        failed.push(id)
      }
    }
    return { failed }
  })

  handleTrusted('overlay:get-settings', () => ({
    ...loadOverlaySettings(),
    visible: overlayVisible,
  }))
  handleTrusted('overlay:toggle', () => {
    setOverlayVisible(!overlayVisible)
    return overlayVisible
  })
  handleTrusted('overlay:set-visible', (_event, visible) => {
    setOverlayVisible(Boolean(visible))
    return overlayVisible
  })
  handleTrusted('video:get-encode-settings', () => {
    let autoDisabled = false
    try {
      autoDisabled = JSON.parse(fs.readFileSync(videoEncodeSettingsPath(), 'utf8'))?.autoDisabled === true
    } catch {
    }
    return { preferGpu: loadPreferGpuEncode(), activeNow: preferGpuEncodeAtStartup, autoDisabled }
  })
  handleTrusted('video:set-prefer-gpu', (_event, preferGpu) => {
    try {
      fs.writeFileSync(videoEncodeSettingsPath(), JSON.stringify({ ...loadVideoEncodeSettings(), preferGpu: Boolean(preferGpu), autoDisabled: false }))
    } catch (err) {
      appendDebugLog('main', `video: falha ao salvar — ${err?.message ?? err}`)
    }
    return { preferGpu: loadPreferGpuEncode(), activeNow: preferGpuEncodeAtStartup }
  })
  handleTrusted('app:system-idle-seconds', () => {
    try {
      return powerMonitor.getSystemIdleTime()
    } catch {
      return null
    }
  })
  handleTrusted('app:get-autostart', () => ({ enabled: getAutoStart(), supported: app.isPackaged }))
  handleTrusted('app:set-autostart', (_event, enabled) => ({ enabled: setAutoStart(Boolean(enabled)), supported: app.isPackaged }))
  handleTrusted('window:set-titlebar-colors', (_event, colors) => {
    const color = typeof colors?.color === 'string' && TITLEBAR_HEX.test(colors.color) ? colors.color : null
    const symbolColor =
      typeof colors?.symbolColor === 'string' && TITLEBAR_HEX.test(colors.symbolColor) ? colors.symbolColor : '#f3efee'
    if (!color || !mainWindow || mainWindow.isDestroyed() || process.platform === 'darwin') return false
    try {
      mainWindow.setTitleBarOverlay({ color, symbolColor, height: 40 })
      fs.writeFileSync(titleBarColorsPath(), JSON.stringify({ color, symbolColor }))
      return true
    } catch {
      return false
    }
  })
  handleTrusted('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })
  handleTrusted('overlay:set-opacity', (_event, opacity) => {
    const n = Number(opacity)
    if (!Number.isFinite(n)) return loadOverlaySettings()
    saveOverlaySettings({ ...loadOverlaySettings(), opacity: Math.max(20, Math.min(100, Math.round(n))) })
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.webContents.isLoading()) {
      overlayWindow.webContents.send('overlay:settings', loadOverlaySettings())
    }
    return loadOverlaySettings()
  })
  handleTrusted('overlay:set-corner', (_event, corner) => {
    if (!OVERLAY_CORNERS.has(corner)) return loadOverlaySettings()
    saveOverlaySettings({ ...loadOverlaySettings(), corner })
    if (overlayWindow && !overlayWindow.isDestroyed()) applyOverlayPlacement(overlayWindow)
    return loadOverlaySettings()
  })

  if (isGameDetectionEnabled()) startGameDetection()
  if (process.platform === 'win32') setTimeout(() => void ensureScanner(), 1500)

  handleTrusted('app:setGameDetectionEnabled', (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('valor inválido')
    return setGameDetectionEnabled(enabled)
  })
  handleTrusted('app:getVersion', () => app.getVersion())
  handleTrusted('app:getCurrentGame', () => currentGame)
  handleTrusted('app:getCurrentGameInfo', () => {
    if (!currentGame) return null
    const generic = genericDetectedGame && genericDetectedGame.label === currentGame ? genericDetectedGame : null
    const steamAppId = generic?.steamAppId ?? STEAM_APP_IDS[currentGame] ?? null
    return {
      label: currentGame,
      antiCheat: antiCheatForGameLabel(currentGame),
      generic: !gameCatalog.findGameByName(currentGame),
      store: steamAppId ? 'Steam' : (generic?.store ?? null),
      steamAppId,
    }
  })

  handleTrusted('secure-storage:get', (_event, key) => {
    if (!isValidSecureStorageKey(key) || !isSecureStorageAvailable()) return { ok: false }
    const store = loadSecureStore()
    const encrypted = store[key]
    if (typeof encrypted !== 'string') return { ok: true, value: null }
    try {
      return { ok: true, value: safeStorage.decryptString(Buffer.from(encrypted, 'base64')) }
    } catch (err) {
      appendDebugLog('main', `secure-storage: falha ao decifrar ${key}: ${err?.message ?? err}`)
      delete store[key]
      persistSecureStore()
      return { ok: true, value: null }
    }
  })
  handleTrusted('secure-storage:set', (_event, key, value) => {
    if (!isValidSecureStorageKey(key) || typeof value !== 'string' || value.length > SECURE_STORAGE_MAX_VALUE) return { ok: false }
    if (!isSecureStorageAvailable()) return { ok: false }
    try {
      const store = loadSecureStore()
      store[key] = safeStorage.encryptString(value).toString('base64')
      return { ok: persistSecureStore() }
    } catch (err) {
      appendDebugLog('main', `secure-storage: falha ao cifrar ${key}: ${err?.message ?? err}`)
      return { ok: false }
    }
  })
  handleTrusted('secure-storage:remove', (_event, key) => {
    if (!isValidSecureStorageKey(key)) return { ok: false }
    const store = loadSecureStore()
    if (key in store) {
      delete store[key]
      return { ok: persistSecureStore() }
    }
    return { ok: true }
  })

  handleTrusted('game-foreground-watch:start', (_event, processNames) => startForegroundWatch(processNames))
  handleTrusted('game-foreground-watch:stop', () => {
    stopForegroundWatch()
  })

  handleTrusted('game-share:watch-process-exit', (_event, processNames) => {
    watchedProcessNames = Array.isArray(processNames)
      ? processNames.slice(0, 32).map((n) => String(n).toLowerCase()).filter(Boolean)
      : []
    watchedProcessWasSeen = false
  })
  handleTrusted('game-share:stop-watch-process-exit', () => {
    watchedProcessNames = []
    watchedProcessWasSeen = false
  })

  let processAudioCaptureProc = null
  let processAudioHeaderBuffer = Buffer.alloc(0)
  let processAudioHeaderParsed = false
  let processAudioPendingChunks = []
  let processAudioFlushTimer = null

  const PROCESS_AUDIO_HEADER_SIZE = 16
  const PROCESS_AUDIO_FLUSH_MS = 40

  function resolveProcessAudioCaptureExePath() {
    const packagedPath = path.join(__dirname, 'process-audio-capture.exe')
    return packagedPath.replace('app.asar', 'app.asar.unpacked')
  }

  function flushProcessAudioChunks() {
    processAudioFlushTimer = null
    if (processAudioPendingChunks.length === 0) return
    const merged = Buffer.concat(processAudioPendingChunks)
    processAudioPendingChunks = []
    sendToMain('process-audio:chunk', merged)
  }

  function queueProcessAudioChunk(chunk) {
    processAudioPendingChunks.push(chunk)
    scheduleProcessAudioFlush()
  }

  function scheduleProcessAudioFlush() {
    if (processAudioFlushTimer) return
    processAudioFlushTimer = setTimeout(flushProcessAudioChunks, PROCESS_AUDIO_FLUSH_MS)
  }

  function stopProcessAudioCapture() {
    if (processAudioFlushTimer) {
      clearTimeout(processAudioFlushTimer)
      processAudioFlushTimer = null
    }
    processAudioPendingChunks = []
    processAudioHeaderBuffer = Buffer.alloc(0)
    processAudioHeaderParsed = false
    if (processAudioCaptureProc) {
      try {
        processAudioCaptureProc.kill()
      } catch {
      }
      processAudioCaptureProc = null
    }
  }

  function startProcessAudioCapture(pid, mode = 'include') {
    stopProcessAudioCapture()
    appendDebugLog('main', `startProcessAudioCapture: pedido pra pid=${pid} (modo=${mode})`)
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Captura de áudio por processo só existe no Windows.' }
    }
    if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
      appendDebugLog('main', `startProcessAudioCapture: pid inválido (${pid})`)
      return { ok: false, error: 'PID inválido.' }
    }
    const exePath = resolveProcessAudioCaptureExePath()
    if (!fs.existsSync(exePath)) {
      appendDebugLog('main', `startProcessAudioCapture: exe não encontrado em ${exePath}`)
      return {
        ok: false,
        error:
          'process-audio-capture.exe não encontrado nesta instalação (build sem esse componente, ou ainda não compilado pro seu sistema).',
      }
    }
    try {
      const args = mode === 'exclude' ? ['--exclude', String(pid)] : [String(pid)]
      const proc = spawn(exePath, args, { windowsHide: true })
      processAudioCaptureProc = proc
      appendDebugLog('main', `startProcessAudioCapture: spawn ok (exe=${exePath}, pid=${pid})`)

      proc.stdout.on('data', (chunk) => {
        if (processAudioCaptureProc !== proc) return
        if (!processAudioHeaderParsed) {
          processAudioHeaderBuffer = Buffer.concat([processAudioHeaderBuffer, chunk])
          if (processAudioHeaderBuffer.length < PROCESS_AUDIO_HEADER_SIZE) return
          const header = processAudioHeaderBuffer.subarray(0, PROCESS_AUDIO_HEADER_SIZE)
          const rest = processAudioHeaderBuffer.subarray(PROCESS_AUDIO_HEADER_SIZE)
          processAudioHeaderBuffer = Buffer.alloc(0)
          processAudioHeaderParsed = true

          const magic = header.readUInt32LE(0)
          if (magic !== 0x4d43504c) {
            appendDebugLog('main', `startProcessAudioCapture: cabeçalho com magic inesperado (0x${magic.toString(16)})`)
            sendToMain('process-audio:error', 'Formato de cabeçalho inesperado.')
            stopProcessAudioCapture()
            return
          }
          const sampleRate = header.readUInt32LE(4)
          const channels = header.readUInt16LE(8)
          const sampleFormat = header.readUInt16LE(10) === 2 ? 'int16' : 'float32'
          appendDebugLog(
            'main',
            `startProcessAudioCapture: formato confirmado (sampleRate=${sampleRate}, channels=${channels}, sampleFormat=${sampleFormat})`
          )
          sendToMain('process-audio:format', { sampleRate, channels, sampleFormat })

          if (rest.length > 0) {
            queueProcessAudioChunk(Buffer.from(rest))
          }
          return
        }
        queueProcessAudioChunk(chunk)
      })

      let stderrBuffer = ''
      proc.stderr?.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf8')
        if (stderrBuffer.length > 64 * 1024) stderrBuffer = stderrBuffer.slice(-8 * 1024)
        let newlineIndex
        while ((newlineIndex = stderrBuffer.indexOf('\n')) >= 0) {
          const line = stderrBuffer.slice(0, newlineIndex).trim()
          stderrBuffer = stderrBuffer.slice(newlineIndex + 1)
          if (line.startsWith('ERROR')) {
            appendDebugLog('main', `startProcessAudioCapture: capture.cpp reportou erro — ${line}`)
            if (processAudioCaptureProc !== proc) continue
            sendToMain('process-audio:error', line.replace(/^ERROR\s*/, ''))
          } else if (line.startsWith('STATUS')) {
            appendDebugLog('main', `startProcessAudioCapture: ${line}`)
          }
        }
      })

      proc.on('error', (err) => {
        appendDebugLog('main', `startProcessAudioCapture: evento 'error' do processo — ${err?.message}`)
        if (processAudioCaptureProc !== proc) return
        sendToMain('process-audio:error', err?.message || 'Falha ao iniciar a captura de áudio.')
        processAudioCaptureProc = null
      })
      proc.on('exit', (code, signal) => {
        appendDebugLog('main', `startProcessAudioCapture: processo encerrou (code=${code}, signal=${signal})`)
        if (processAudioCaptureProc === proc) processAudioCaptureProc = null
      })

      return { ok: true }
    } catch (err) {
      appendDebugLog('main', `startProcessAudioCapture: exceção ao dar spawn — ${err?.message}`)
      return { ok: false, error: err?.message || 'Falha desconhecida ao iniciar a captura.' }
    }
  }

  handleTrusted('process-audio:start', (_event, pid) => startProcessAudioCapture(pid))
  handleTrusted('process-audio:start-excluding-self', () => startProcessAudioCapture(process.pid, 'exclude'))
  handleTrusted('process-audio:stop', () => stopProcessAudioCapture())

  function createNativeFrameCaptureChannel(channelPrefix, exeFileName, expectedMagic) {
    let proc = null
    let headerBuffer = Buffer.alloc(0)
    let headerParsed = false
    let pendingChunks = []
    let pendingBytes = 0
    const HEADER_SIZE = 16
    const MAX_FRAME_BYTES = 64 * 1024 * 1024

    function resolveExePath() {
      const packagedPath = path.join(__dirname, exeFileName)
      return packagedPath.replace('app.asar', 'app.asar.unpacked')
    }

    function stop() {
      headerBuffer = Buffer.alloc(0)
      headerParsed = false
      pendingChunks = []
      pendingBytes = 0
      if (proc) {
        try {
          proc.kill()
        } catch {
        }
        proc = null
      }
    }

    function takePending() {
      const merged = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingBytes)
      pendingChunks = [merged]
      return merged
    }

    function drainFrames() {
      if (pendingBytes < 4) return
      let buffer = takePending()
      let latestFrame = null
      let offset = 0
      while (buffer.length - offset >= 4) {
        const frameSize = buffer.readUInt32LE(offset)
        if (frameSize > MAX_FRAME_BYTES) {
          appendDebugLog('main', `${channelPrefix}: tamanho de quadro inválido (${frameSize}) — fluxo corrompido, encerrando`)
          sendToMain(`${channelPrefix}:error`, 'Fluxo de vídeo corrompido.')
          stop()
          return
        }
        if (buffer.length - offset < 4 + frameSize) break
        latestFrame = buffer.subarray(offset + 4, offset + 4 + frameSize)
        offset += 4 + frameSize
      }
      if (offset > 0) {
        const rest = Buffer.from(buffer.subarray(offset))
        pendingChunks = rest.length > 0 ? [rest] : []
        pendingBytes = rest.length
      }
      if (latestFrame) {
        sendToMain(`${channelPrefix}:frame`, Buffer.from(latestFrame))
      }
    }

    function start(monitorIndex) {
      stop()
      appendDebugLog('main', `${channelPrefix}: pedido (monitorIndex=${monitorIndex})`)
      if (process.platform !== 'win32') {
        return { ok: false, error: `${channelPrefix} só existe no Windows.` }
      }
      const exePath = resolveExePath()
      if (!fs.existsSync(exePath)) {
        appendDebugLog('main', `${channelPrefix}: exe não encontrado em ${exePath}`)
        return { ok: false, error: `${exeFileName} não encontrado nesta instalação (build sem esse componente).` }
      }
      try {
        const args =
          Number.isFinite(monitorIndex) && monitorIndex > 0 && monitorIndex < 64 ? [String(Math.trunc(monitorIndex))] : []
        const child = spawn(exePath, args, { windowsHide: true })
        proc = child
        appendDebugLog('main', `${channelPrefix}: spawn ok (exe=${exePath}, args=${JSON.stringify(args)})`)

        child.stdout.on('data', (chunk) => {
          if (proc !== child) return
          if (!headerParsed) {
            headerBuffer = Buffer.concat([headerBuffer, chunk])
            if (headerBuffer.length < HEADER_SIZE) return
            const header = headerBuffer.subarray(0, HEADER_SIZE)
            const rest = Buffer.from(headerBuffer.subarray(HEADER_SIZE))
            pendingChunks = rest.length > 0 ? [rest] : []
            pendingBytes = rest.length
            headerBuffer = Buffer.alloc(0)
            headerParsed = true

            const magic = header.readUInt32LE(0)
            if (magic !== expectedMagic) {
              appendDebugLog('main', `${channelPrefix}: cabeçalho com magic inesperado (0x${magic.toString(16)})`)
              sendToMain(`${channelPrefix}:error`, 'Formato de cabeçalho inesperado.')
              stop()
              return
            }
            const width = header.readUInt32LE(4)
            const height = header.readUInt32LE(8)
            appendDebugLog('main', `${channelPrefix}: formato confirmado (${width}x${height})`)
            sendToMain(`${channelPrefix}:format`, { width, height })
            drainFrames()
            return
          }
          pendingChunks.push(chunk)
          pendingBytes += chunk.length
          drainFrames()
        })

        let stderrBuffer = ''
        child.stderr?.on('data', (chunk) => {
          stderrBuffer += chunk.toString('utf8')
          if (stderrBuffer.length > 64 * 1024) stderrBuffer = stderrBuffer.slice(-8 * 1024)
          let newlineIndex
          while ((newlineIndex = stderrBuffer.indexOf('\n')) >= 0) {
            const line = stderrBuffer.slice(0, newlineIndex).trim()
            stderrBuffer = stderrBuffer.slice(newlineIndex + 1)
            if (line.startsWith('ERROR')) {
              appendDebugLog('main', `${channelPrefix}: reportou erro — ${line}`)
              if (proc === child) sendToMain(`${channelPrefix}:error`, line.replace(/^ERROR\s*/, ''))
            } else if (line.startsWith('STATUS')) {
              appendDebugLog('main', `${channelPrefix}: ${line}`)
            }
          }
        })

        child.on('error', (err) => {
          appendDebugLog('main', `${channelPrefix}: evento 'error' do processo — ${err?.message}`)
          if (proc !== child) return
          sendToMain(`${channelPrefix}:error`, err?.message || 'Falha ao iniciar a captura.')
          proc = null
        })
        child.on('exit', (code, signal) => {
          appendDebugLog('main', `${channelPrefix}: processo encerrou (code=${code}, signal=${signal})`)
          if (proc === child) proc = null
        })

        return { ok: true }
      } catch (err) {
        appendDebugLog('main', `${channelPrefix}: exceção ao dar spawn — ${err?.message}`)
        return { ok: false, error: err?.message || 'Falha desconhecida ao iniciar a captura.' }
      }
    }

    return { start, stop }
  }

  const wgcCapture = createNativeFrameCaptureChannel('screen-capture-wgc', 'screen-capture-wgc.exe', 0x4d435747)
  const gdiCapture = createNativeFrameCaptureChannel('screen-capture-gdi', 'screen-capture-gdi.exe', 0x4d434746)

  handleTrusted('screen-capture-wgc:start', (_event, monitorIndex) => wgcCapture.start(monitorIndex))
  handleTrusted('screen-capture-wgc:stop', () => wgcCapture.stop())
  handleTrusted('screen-capture-gdi:start', (_event, monitorIndex) => gdiCapture.start(monitorIndex))
  handleTrusted('screen-capture-gdi:stop', () => gdiCapture.stop())

  onTrusted('debug:log', (_event, message) => {
    appendDebugLog('renderer', String(message))
  })

  let pttGlobalKeycode = null
  let pttCaptureResolver = null
  let pttKeyDown = false
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
      if (pttGlobalKeycode !== null && e.keycode === pttGlobalKeycode && !pttKeyDown) {
        pttKeyDown = true
        sendToMain('ptt-state', true)
      }
    })
    uIOhook.on('keyup', (e) => {
      if (pttGlobalKeycode !== null && e.keycode === pttGlobalKeycode) {
        pttKeyDown = false
        sendToMain('ptt-state', false)
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
      console.error('Falha ao iniciar uiohook (push-to-talk vai funcionar só com o app em foco):', err?.message)
      uiohookAvailable = false
      return false
    }
  }

  handleTrusted('ptt:is-global-available', () => tryLoadUiohook())

  handleTrusted('ptt:start-capture', () => {
    if (!ensureUiohookStarted()) return Promise.resolve(null)
    if (pttCaptureResolver) {
      const previous = pttCaptureResolver
      pttCaptureResolver = null
      previous(null)
    }
    return new Promise((resolve) => {
      pttCaptureResolver = resolve
      setTimeout(() => {
        if (pttCaptureResolver === resolve) {
          pttCaptureResolver = null
          resolve(null)
        }
      }, 10_000)
    })
  })

  handleTrusted('ptt:set-active-key', (_event, keycode) => {
    pttGlobalKeycode = Number.isSafeInteger(keycode) ? keycode : null
    pttKeyDown = false
    if (pttGlobalKeycode !== null) ensureUiohookStarted()
  })

  function stopRendererBoundWork(reason) {
    appendDebugLog('main', `stopRendererBoundWork: ${reason}`)
    stopForegroundWatch()
    stopProcessAudioCapture()
    wgcCapture.stop()
    gdiCapture.stop()
    watchedProcessNames = []
    watchedProcessWasSeen = false
    pttKeyDown = false
    if (pttCaptureResolver) {
      const resolve = pttCaptureResolver
      pttCaptureResolver = null
      resolve(null)
    }
  }
  win.webContents.on('render-process-gone', () => stopRendererBoundWork('render-process-gone'))
  let firstMainNavigationDone = false
  win.webContents.on('did-navigate', () => {
    if (!firstMainNavigationDone) {
      firstMainNavigationDone = true
      return
    }
    stopRendererBoundWork('página principal recarregada/navegou')
  })

  app.once('before-quit', () => {
    isQuitting = true
    stopGameDetection()
    if (uiohookAvailable && uiohookStarted) {
      try {
        uIOhook.stop()
      } catch {
      }
    }
    stopForegroundWatch()
    stopProcessAudioCapture()
    wgcCapture.stop()
    gdiCapture.stop()
    globalShortcut.unregisterAll()
  })
  app.once('will-quit', () => {
    flushDebugLogSync()
  })

  let lastUpdateStatus = null
  handleTrusted('app:get-update-status', () => lastUpdateStatus)

  if (!isDev) {
    const UPDATE_DOWNLOAD_PAGE = 'https://github.com/Felipe-M-Soares/mamacoVoip-releases/releases/latest'
    const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
    const NETWORK_RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000]

    let updateCheckSilent = false
    let updateCheckInFlight = false
    let updateDownloadInFlight = false
    let lastUpdateCheckAt = 0
    let lastSentPercent = -1
    let availableVersion = null
    let updateRetryTimer = null
    let networkRetryCount = 0
    let updateIntervalTimer = null

    autoUpdater.logger = {
      info: (msg) => appendDebugLog('updater', msg),
      warn: (msg) => appendDebugLog('updater:warn', msg),
      error: (msg) => appendDebugLog('updater:error', msg),
      debug: () => {},
    }
    autoUpdater.disableWebInstaller = true

    function sendUpdateStatus(status, extra = {}) {
      const payload = { status, ...extra }
      lastUpdateStatus = status === 'downloading' || status === 'ready' ? payload : null
      sendToMain('update-status', payload)
    }

    function clearUpdateRetryTimer() {
      if (updateRetryTimer) clearTimeout(updateRetryTimer)
      updateRetryTimer = null
    }

    function scheduleUpdateRetry(delayMs) {
      clearUpdateRetryTimer()
      updateRetryTimer = setTimeout(() => {
        updateRetryTimer = null
        runUpdateCheck({ silent: true, isRetry: true })
      }, delayMs)
    }

    function runUpdateCheck({ silent, isRetry = false }) {
      if (process.windowsStore) {
        if (!silent) sendToMain('update-status', { status: 'not-available' })
        return
      }
      if (updateReadyToInstall || updateDownloadInFlight) {
        if (!silent && lastUpdateStatus) sendToMain('update-status', lastUpdateStatus)
        return
      }
      if (updateCheckInFlight) return
      if (!isRetry) clearUpdateRetryTimer()
      updateCheckSilent = silent
      updateCheckInFlight = true
      lastUpdateCheckAt = Date.now()
      autoUpdater
        .checkForUpdates()
        .catch(() => {
        })
        .finally(() => {
          updateCheckInFlight = false
        })
    }

    autoUpdater.on('checking-for-update', () => {
      if (!updateCheckSilent) sendUpdateStatus('checking')
    })
    autoUpdater.on('update-available', (info) => {
      networkRetryCount = 0
      updateDownloadInFlight = true
      lastSentPercent = -1
      availableVersion = info?.version ?? null
      if (startupGatePending) {
        startupUpdating = true
        appendDebugLog('updater', `abertura: versão ${availableVersion} encontrada — atualizando direto`)
        showStartupUpdating(0)
        setTimeout(() => {
          if (startupUpdating && !updateReadyToInstall) {
            appendDebugLog('updater', 'abertura: download demorando — abrindo o app e continuando por trás')
            releaseStartupGate()
          }
        }, 5 * 60_000)
        return
      }
      sendUpdateStatus('downloading', { version: availableVersion })
    })
    autoUpdater.on('update-not-available', () => {
      networkRetryCount = 0
      if (startupGatePending) releaseStartupGate()
      if (!updateCheckSilent) sendUpdateStatus('up-to-date')
    })
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.floor(progress?.percent ?? 0)))
      if (percent === lastSentPercent) return
      lastSentPercent = percent
      if (startupUpdating) {
        showStartupUpdating(percent)
        return
      }
      sendUpdateStatus('downloading', { percent, version: availableVersion })
    })
    autoUpdater.on('update-downloaded', (info) => {
      updateDownloadInFlight = false
      updateReadyToInstall = true
      clearUpdateRetryTimer()
      if (startupUpdating) {
        showStartupUpdating(100)
        isQuitting = true
        setTimeout(() => {
          try {
            autoUpdater.quitAndInstall(true, true)
          } catch (err) {
            isQuitting = false
            appendDebugLog('updater:error', `abertura: quitAndInstall falhou — ${err?.message ?? err}`)
            releaseStartupGate()
          }
        }, 600)
        return
      }
      sendUpdateStatus('ready', { version: info.version })
      if (tray) tray.setToolTip(`Mamacos Voip — atualização v${info.version} pronta (reinicie pra aplicar)`)
      if (Notification.isSupported()) {
        new Notification({
          title: 'Atualização pronta',
          body: `Mamacos Voip v${info.version} já foi baixado. Reinicie o app pra aplicar.`,
        }).show()
      }
    })
    let updateRetryCount = 0
    const MAX_UPDATE_RETRIES = 2
    const UPDATE_RETRY_DELAY_MS = 4_000
    const NETWORK_ERROR_PATTERN =
      /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED|ABORTED|FAILED)|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY_CONNECTION_FAILED|ERR_NETWORK_IO_SUSPENDED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up|net::ERR_/i

    autoUpdater.on('error', (err) => {
      const wasDownloading = updateDownloadInFlight
      updateDownloadInFlight = false
      if (startupGatePending || startupUpdating) {
        appendDebugLog('updater', 'abertura: falha ao atualizar — abrindo o app normalmente')
        releaseStartupGate()
      }

      let raw = 'Erro desconhecido'
      try {
        raw = JSON.stringify(err, Object.getOwnPropertyNames(err))
      } catch {
        raw = err?.message ?? String(err)
      }
      appendDebugLog('updater:error-event', raw.slice(0, 2000))

      if (raw.includes('404') && updateRetryCount < MAX_UPDATE_RETRIES) {
        updateRetryCount++
        clearUpdateRetryTimer()
        const silent = updateCheckSilent
        updateRetryTimer = setTimeout(() => {
          updateRetryTimer = null
          runUpdateCheck({ silent, isRetry: true })
        }, UPDATE_RETRY_DELAY_MS)
        return
      }

      if (/latest\.yml|Cannot find channel/i.test(raw)) {
        if (!updateCheckSilent) sendUpdateStatus('up-to-date')
        return
      }

      if (NETWORK_ERROR_PATTERN.test(raw)) {
        const delay = NETWORK_RETRY_DELAYS_MS[Math.min(networkRetryCount, NETWORK_RETRY_DELAYS_MS.length - 1)]
        networkRetryCount++
        scheduleUpdateRetry(delay)
        if (!updateCheckSilent || wasDownloading) {
          sendUpdateStatus('error', {
            message: `Sem conexão com o servidor de atualizações. Vou tentar de novo sozinho em ${Math.round(delay / 60_000)} min.`,
            downloadUrl: UPDATE_DOWNLOAD_PAGE,
          })
        }
        return
      }

      const looksLikeSignatureIssue = /signature|publisher|checksum|sha512/i.test(raw)
      if (looksLikeSignatureIssue) {
        sendUpdateStatus('error', {
          message:
            'A atualização foi baixada mas não pôde ser verificada automaticamente (provavelmente porque o instalador não tem assinatura digital — isso exige um certificado pago). Baixe a versão mais recente manualmente pelo site.',
          downloadUrl: UPDATE_DOWNLOAD_PAGE,
        })
        return
      }

      if (updateCheckSilent && !wasDownloading) return

      sendUpdateStatus('error', { message: raw.slice(0, 400), downloadUrl: UPDATE_DOWNLOAD_PAGE })
    })

    handleTrusted('app:restartToUpdate', () => {
      if (!updateReadyToInstall) return false
      isQuitting = true
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(true, true)
        } catch (err) {
          isQuitting = false
          appendDebugLog('updater:error', `quitAndInstall falhou — ${err?.message ?? err}`)
          sendUpdateStatus('error', {
            message: 'Não foi possível aplicar a atualização agora. Feche e abra o app pra tentar de novo.',
            downloadUrl: UPDATE_DOWNLOAD_PAGE,
          })
        }
      })
      return true
    })
    onTrusted('app:check-for-updates-now', () => {
      updateRetryCount = 0
      networkRetryCount = 0
      runUpdateCheck({ silent: false })
    })

    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/Felipe-M-Soares/mamacoVoip-releases/releases/latest/download/',
    })

    if (process.windowsStore || process.platform !== 'win32') {
      releaseStartupGate()
    } else {
      startupGatePending = true
      setTimeout(() => {
        if (startupGatePending && !startupUpdating) {
          appendDebugLog('updater', 'abertura: sem resposta em 4s — abrindo o app normalmente')
          releaseStartupGate()
        }
      }, 4_000)
      runUpdateCheck({ silent: true })
    }

    win.once('ready-to-show', () => {
      updateIntervalTimer = setInterval(() => runUpdateCheck({ silent: true }), UPDATE_CHECK_INTERVAL_MS)
    })

    powerMonitor.on('resume', () => {
      if (Date.now() - lastUpdateCheckAt < 10 * 60_000) return
      setTimeout(() => runUpdateCheck({ silent: true }), 15_000)
    })

    app.once('before-quit', () => {
      if (updateIntervalTimer) clearInterval(updateIntervalTimer)
      updateIntervalTimer = null
      clearUpdateRetryTimer()
    })
  }

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      return
    }
    const newWin = createWindow()
    newWin.once('ready-to-show', () => newWin.show())
  })
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (contents === mainWindow?.webContents) return
    if (url !== contents.getURL()) event.preventDefault()
  })
})

app.on('window-all-closed', () => {
  stopGameDetection()
  stopForegroundWatch()
  globalShortcut.unregisterAll()
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  if (process.platform !== 'darwin') {
    if (updateReadyToInstall) {
      isQuitting = true
      autoUpdater.quitAndInstall(true, true)
    } else {
      app.quit()
    }
  }
})
