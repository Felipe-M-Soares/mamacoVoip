const { app, BrowserWindow, session, Menu, Tray, nativeImage, Notification, shell, ipcMain, dialog, protocol, net, desktopCapturer, globalShortcut, screen, powerMonitor, safeStorage, clipboard } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { exec, spawn } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

// Só pode existir UMA instância do app rodando ao mesmo tempo. Sem isso,
// cada clique no atalho (ou ícone da área de trabalho/menu iniciar)
// enquanto o app já está aberto — mesmo minimizado ou só na bandeja —
// simplesmente abre uma janela NOVA do zero, em vez de trazer a que já
// existe pra frente. É exatamente o bug relatado: "abre outro em vez de
// puxar o que está minimizado". app.requestSingleInstanceLock() garante
// que só a PRIMEIRA instância continua de verdade; qualquer tentativa
// seguinte dispara o evento 'second-instance' nessa primeira instância
// (handler registrado mais abaixo, perto da criação da janela) e se
// encerra na hora — sem isso o `return` aqui embaixo, o resto do arquivo
// (registro de protocolo, criação de janela, etc.) nunca chega a rodar
// pra essa segunda tentativa. É assim que apps como um app de chat popular conseguem
// "puxar" a janela já aberta em vez de duplicar.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  return
}

// VIGÉSIMA SEGUNDA RODADA — relatado com razão: "mas o OBS e outros apps
// capturam esses jogos tranquilamente". Isso é verdade, e joga por
// terra a explicação de que tela cheia exclusiva com anti-cheat SEMPRE
// quebra a duplicação de tela — se fosse uma regra dura do Windows, o
// Display Capture do OBS (que usa a MESMA API de duplicação de tela,
// DXGI Output Duplication) também falharia sempre, e não falha. A
// diferença real está em QUEM implementa a captura: o OBS e outros apps
// têm pipeline de captura PRÓPRIO, escrito à mão em C++ direto contra
// as APIs do Windows, com lógica de recuperação pra exatamente esses
// casos de borda (ex.: reconstruir a interface de duplicação quando o
// Windows invalida ela num troca de modo de vídeo — erro
// DXGI_ERROR_ACCESS_LOST, bem documentado). Este app, até agora, usa o
// capturador EMBUTIDO do Chromium (via desktopCapturer/getUserMedia) —
// que existe há mais tempo mas historicamente é menos "blindado" contra
// esse tipo de caso de borda especificamente.
//
// O Chromium também tem, mais recente, um capturador alternativo
// baseado em Windows Graphics Capture (WGC — a mesma tecnologia por
// trás do Xbox Game Bar, que lida melhor com jogos em modo exclusivo do
// que a duplicação de tela clássica), mas ele fica atrás de feature
// flags desligadas por padrão nessa versão do Electron/Chromium. Essa
// troca de linha de comando pede pro Chromium usar esse capturador
// alternativo pra tela E janela, tanto pra captura em si quanto pra
// gerar a miniatura na lista de fontes. É experimental (o nome exato
// dessas flags já mudou de versão pra versão do Chromium ao longo do
// tempo, sem garantia de que essa é a atual pra essa build específica)
// e SEGURO tentar de qualquer forma: se o nome não bater com nada que
// essa versão reconheça, o Chromium simplesmente ignora — não quebra
// nada que já funciona (janela normal continua exatamente igual).
//
// CORREÇÃO (crash ao compartilhar a TELA INTEIRA): o capturador WGC do
// Chromium pra TELA (WebRtcAllowWgcScreenCapturer) saiu — ele é
// experimental (como o próprio texto acima admite) e era a ÚNICA diferença,
// no nível do Chromium, entre capturar um monitor (quebrava) e capturar uma
// janela (funcionava). Sem ele, monitor volta pro capturador padrão e bem
// testado do Chromium (DXGI Desktop Duplication). O caso que motivou a flag
// (jogo em tela cheia EXCLUSIVA, que o DXGI não enxerga) continua coberto
// pelo fallback nativo próprio (screen-capture-wgc.exe, ver
// createNativeFrameCaptureChannel mais abaixo), que entra sozinho quando a
// captura normal falha. WGC pra JANELA continua ligado (nunca deu problema).
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowWgcWindowCapturer')

// Login com Google — o navegador do sistema não tem como abrir uma
// janela do Electron diretamente, então o "endereço de volta" pro app
// depois da pessoa aceitar no Google é um esquema de URL customizado
// (tipo "mailto:", mas nosso), registrado no sistema operacional. O
// Windows entrega esse link de duas formas: (1) se o app já está
// aberto, chega como argumento de linha de comando pra uma segunda
// tentativa de abrir o app, capturado pelo 'second-instance' já
// existente mais abaixo; (2) se o app estava fechado, o Windows abre o
// app JÁ passando o link como argumento inicial (process.argv), então
// isso aqui embaixo precisa rodar bem cedo, antes até da janela
// existir — por isso um "recado pendente" que só é entregue depois que
// a janela principal termina de carregar (ver 'did-finish-load' lá na
// criação da janela). No macOS o sistema tem um jeito próprio de
// avisar (evento 'open-url'), registrado logo abaixo.
//
// Também precisa estar declarado no instalador (ver "protocols" em
// package.json) — sem isso, o Windows nunca aprende que é este app
// quem trata esse esquema de link.
const AUTH_DEEP_LINK_SCHEME = 'mamacovoip'
// AUDITORIA: rodando em desenvolvimento (`electron .`), o executável é o
// electron.exe genérico — registrar o esquema sem passar o caminho do
// app faria o Windows abrir um Electron "vazio" ao clicar no link de
// volta do login. Em produção (process.defaultApp === undefined) a
// chamada simples continua sendo a certa.
if (process.defaultApp && process.argv.length >= 2) {
  if (!app.isDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])) {
    app.setAsDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  }
} else if (!app.isDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME)) {
  app.setAsDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME)
}

// AUDITORIA: o link de volta chega como argumento de linha de comando —
// ou seja, QUALQUER programa (ou página web, via link mamacovoip://)
// consegue mandar um texto arbitrário até aqui. O renderer já valida o
// `state` do OAuth (ver AuthContext.tsx), mas não custa nada barrar no
// processo principal o que claramente não é um link nosso: tamanho
// absurdo ou algo que nem é uma URL válida desse esquema.
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

// Cobre o caso (2) acima: app fechado, aberto direto pelo link.
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

// macOS entrega o link por esse evento dedicado, em vez de argv — e
// pode disparar antes até do app estar "pronto" (ready), por isso
// registrado bem no topo do arquivo.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleAuthDeepLink(url)
})

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

// ============================================================
// DÉCIMA QUARTA RODADA — log em ARQUIVO, sem depender do DevTools.
// Motivo direto: pedi pra abrir o DevTools (Ctrl+Shift+I) pra ver por
// que a captura de áudio (por processo OU a reserva de sistema) estava
// falhando muda, e a resposta foi "não tem como, o app é instalado no
// PC" — ou seja, a pessoa nem sabia que dava pra abrir DevTools num app
// Electron empacotado (e o atalho de teclado pode nem chegar até a
// janela certa se outra janela — o próprio jogo — estiver em foco, ver
// o item "Ferramentas do desenvolvedor" na bandeja e o atalho GLOBAL
// registrados mais abaixo). Um arquivo de log simples remove essa
// dependência inteira: só precisa abrir um .txt no Bloco de Notas.
// Grava tanto o que o processo PRINCIPAL sabe (spawn do
// process-audio-capture.exe, formato/erro reportado por ele) quanto o
// que o RENDERER sabe (ver window.electronAPI.logDebug em preload.cjs e
// os pontos de uso em VoiceContext.tsx) — tudo no mesmo arquivo, em
// ordem, pra dar o quadro completo de uma tentativa de compartilhamento
// sem precisar cruzar dois lugares diferentes.
const fs = require('node:fs')
const debugLogPath = path.join(app.getPath('userData'), 'mamacos-debug.log')
// AUDITORIA — dois problemas reais no log original:
//  1. crescia SEM LIMITE (cada sessão de compartilhamento grava várias
//     linhas, e o renderer também escreve aqui via debug:log) — em
//     semanas de uso vira dezenas/centenas de MB no AppData. Agora, ao
//     passar de DEBUG_LOG_MAX_BYTES, o arquivo atual vira
//     "mamacos-debug.log.1" (substituindo o anterior) e um novo começa.
//  2. usava appendFileSync — escrita SÍNCRONA em disco na thread
//     principal do Electron, que é a mesma que repassa quadros de vídeo
//     e áudio pro renderer. Agora as linhas vão pra uma fila e são
//     gravadas de forma assíncrona, em lote.
const DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024
const DEBUG_LOG_MAX_LINE = 8000
let debugLogQueue = []
let debugLogFlushing = false
let debugLogSize = -1 // -1 = ainda não sabemos o tamanho atual do arquivo

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
          // sem arquivo ainda, ou travado por outro programa — segue sem girar
        }
        debugLogSize = 0
      }
      try {
        await fs.promises.appendFile(debugLogPath, chunk)
        debugLogSize += chunkBytes
      } catch {
        // Sem essa pasta gravável, ou disco cheio — não é crítico o
        // suficiente pra incomodar quem está usando o app com isso.
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

// Na hora de fechar o app não dá pra esperar a fila assíncrona — grava o
// que sobrou de forma síncrona (uma vez só, fora de qualquer caminho quente).
function flushDebugLogSync() {
  if (debugLogQueue.length === 0) return
  const chunk = debugLogQueue.join('')
  debugLogQueue = []
  try {
    fs.appendFileSync(debugLogPath, chunk)
  } catch {
    // idem acima
  }
}

// Diagnóstico do crash ao compartilhar a tela: além do renderer
// ('render-process-gone', ver createWindow), um processo AUXILIAR do
// Chromium também pode cair durante a captura/codificação (GPU — encoder
// de vídeo por hardware —, serviço de áudio — loopback do sistema —,
// serviço de captura de vídeo). Antes isso não era registrado em lugar
// nenhum; agora vai pro mamacos-debug.log com o tipo do processo.
app.on('child-process-gone', (_event, details) => {
  appendDebugLog(
    'main',
    `child-process-gone: type=${details?.type} reason=${details?.reason} exitCode=${details?.exitCode}` +
      `${details?.serviceName ? ` service=${details.serviceName}` : ''}${details?.name ? ` name=${details.name}` : ''}`
  )
})

// Rede de segurança geral: se algum erro escapar de todos os try/catch
// (de qualquer parte do app, não só do push-to-talk), isso evita que
// ele derrube o processo principal inteiro — o que travaria o app
// inteiro pra todo mundo, muito pior do que uma função específica
// falhar sozinha.
process.on('uncaughtException', (err) => {
  console.error('Erro não tratado no processo principal:', err)
  // DÉCIMA SÉTIMA RODADA: além do console (que ninguém vê num app
  // empacotado — foi exatamente esse o motivo de existir o log em
  // arquivo acima, appendDebugLog), grava aqui também. AUDITORIA: o
  // bloco do log foi movido pra ANTES destes handlers — antes ele vinha
  // depois, e `debugLogPath` (uma const) ainda estaria na "zona morta"
  // se um erro acontecesse cedo demais, fazendo o próprio handler lançar
  // outro erro.
  appendDebugLog('main:uncaughtException', `${err?.message ?? err}\n${err?.stack ?? ''}`)
})

// Antes só existia o de cima (uncaughtException) — uma Promise rejeitada
// sem .catch() no processo principal NÃO dispara esse evento, dispara
// este aqui (unhandledRejection), que não existia. Mesmo tratamento:
// não derruba o processo, só registra pra dar pra diagnosticar depois.
process.on('unhandledRejection', (reason) => {
  console.error('Promise rejeitada sem tratamento no processo principal:', reason)
  const detail = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)
  appendDebugLog('main:unhandledRejection', detail)
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
// B4 — Content-Security-Policy das páginas servidas pelo app:// (só no
// app empacotado; em desenvolvimento a página vem do servidor do Vite).
// Mesma política do site (vercel.json), sem frame-ancestors (a janela
// não é embutida em lugar nenhum) — se trocar uma, troque a outra:
//   - connect-src: Supabase (REST/Auth/Storage/Edge Functions em https,
//     Realtime em wss), LiveKit Cloud (sinalização wss + https) e a API
//     da GIPHY. Se o Supabase/LiveKit usar domínio próprio, inclua aqui.
//   - img/media: https:, data: e blob: (anexos por URL assinada, GIFs,
//     avatares, prévias de link, gravações locais).
//   - 'wasm-unsafe-eval' + worker/blob: supressão de ruído (WASM em
//     AudioWorklet) e LiveKit.
const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://api.giphy.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
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

function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url)
    // AUDITORIA: compara a ORIGEM exata (antes era `startsWith`, que
    // aceitaria algo como "http://localhost:5173.site-malicioso.com").
    if (isDev) return parsed.origin === DEV_SERVER_ORIGIN
    return parsed.protocol === 'app:' && parsed.host === 'bundle'
  } catch {
    return false
  }
}

// AUDITORIA — manda uma mensagem pra janela principal sem risco de
// lançar "Object has been destroyed": `sendToMain(...)`
// (usado em vários lugares antes) só protege contra `mainWindow` ser
// null, não contra a janela/webContents já ter sido destruída (ex.: um
// evento de processo filho ou do auto-updater chegando bem durante o
// fechamento do app) — o que virava uma exceção não tratada no processo
// principal.
function sendToMain(channel, ...args) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const contents = mainWindow.webContents
  if (!contents || contents.isDestroyed()) return
  try {
    contents.send(channel, ...args)
  } catch {
    // janela fechando bem nesse instante — nada a fazer
  }
}

// AUDITORIA — validação do REMETENTE de toda mensagem IPC (recomendação
// explícita do checklist de segurança do Electron). Sem isso, qualquer
// frame que por algum motivo conseguisse rodar dentro de uma janela
// nossa (um iframe de terceiros, uma página carregada por engano) teria
// acesso às mesmas funções poderosas do processo principal: iniciar
// capturas de tela/áudio, restaurar janelas de outros programas, etc.
// Só aceitamos mensagens vindas do FRAME PRINCIPAL de uma página do
// próprio app (app://bundle em produção, o servidor do Vite em dev).
function isTrustedIpcSender(event) {
  const frame = event?.senderFrame
  if (!frame) return false
  if (frame.parent) return false // só o frame principal, nunca um iframe
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

// TRIGÉSIMA SEXTA RODADA — falha de segurança real encontrada numa
// revisão geral: `shell.openExternal(url)` (usado logo abaixo, pros
// dois casos de "isso não é navegação dentro do app, abre no
// navegador/programa padrão do sistema") estava sendo chamado pra
// QUALQUER protocolo, sem checagem nenhuma antes. Isso importa porque
// esse `url` pode vir de um link que OUTRA PESSOA colou numa mensagem
// de chat, num convite, ou em qualquer texto que o app renderiza como
// link clicável — não é um dado confiável. `shell.openExternal` só
// deveria ser usado pra abrir coisas que fazem sentido abrir num
// navegador (http/https) ou cliente de e-mail (mailto) — outros
// protocolos (file:, ou handlers registrados no Windows por outros
// programas instalados) podem disparar comportamento do sistema
// operacional bem além de "abrir uma página", que é o único
// comportamento que a pessoa espera ao clicar um link dentro de um
// app de chat. Essa é a mitigação recomendada pela própria
// documentação de segurança do Electron pra esse padrão exato.
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
function openExternalSafely(url) {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      appendDebugLog('main', `openExternalSafely: bloqueado protocolo não permitido (${parsed.protocol}) — url=${url}`)
      return
    }
    // openExternal devolve uma Promise — sem o .catch, uma falha (ex.:
    // nenhum navegador padrão configurado) virava unhandledRejection.
    shell.openExternal(parsed.toString()).catch((err) => {
      appendDebugLog('main', `openExternalSafely: falha ao abrir — ${err?.message ?? err}`)
    })
  } catch {
    // URL malformada — nem tenta abrir
  }
}

// Lista de jogos conhecidos (nome exibido, executáveis, anti-cheat) —
// fica em electron/gameCatalog.cjs (módulo puro, testado pelo Vitest em
// src/lib/gameCatalog.test.ts). KNOWN_GAMES continua existindo no formato
// antigo { 'exe': 'Nome' } porque o resto deste arquivo usa ele.
// Detecção é por nome de processo em execução (tasklist), confirmada por
// uma JANELA visível do processo — funciona bem no Windows; no Mac/Linux
// a cobertura é limitada. Jogos FORA do catálogo ainda são reconhecidos
// pelo fallback genérico (pasta da Steam/Epic/Riot/Xbox/...), ver
// detectGenericGameFromPath e runForegroundCheckTick.
//
// IMPORTANTE (anti-cheat): nada aqui injeta código em processo de jogo.
// Só lemos a lista de processos (tasklist) e perguntamos ao Windows qual
// janela está em primeiro plano / onde ela está (user32, somente leitura)
// — exatamente o que o Gerenciador de Tarefas faz. Vanguard, EAC,
// BattlEye, Ricochet, FACEIT etc. não bloqueiam nem punem isso.
const win32native = require('./win32native.cjs')
const gameCatalog = require('./gameCatalog.cjs')
const KNOWN_GAMES = gameCatalog.buildKnownGamesMap()

// Combina o nome do processo (chave do dicionário acima) SEM a
// extensão .exe também, já que no Mac/Linux processos não costumam
// ter esse sufixo — melhora um pouco a cobertura fora do Windows,
// mesmo que a lista tenha sido pensada primariamente pra ele.
const GAME_CHECK_INTERVAL_MS = 15_000
// Intervalo do "último app em primeiro plano" (lastForegroundApp) — bem
// menor que o da lista de processos pra pegar o jogo certo quando a pessoa
// alterna pra ele e volta rápido pro app pra compartilhar.
const FOREGROUND_CHECK_INTERVAL_MS = 3_000

let mainWindow = null
let isQuitting = false
let updateReadyToInstall = false
let gameCheckTimer = null
let foregroundCheckTimer = null
// Evita duas consultas de primeiro plano sobrepostas.
let foregroundCheckInFlight = false
let currentGame = null
// Última janela que esteve em primeiro plano ENQUANTO nossa própria janela
// não estava em foco — ver getForegroundWindowInfo/o laço em
// startGameDetection abaixo pro porquê disso existir (generaliza o atalho
// "Compartilhar seu jogo" pra QUALQUER jogo/app, não só os da lista
// KNOWN_GAMES).
let lastForegroundApp = null
// Jogo FORA do catálogo reconhecido pela pasta da loja (Steam/Epic/Riot/
// Xbox/...) quando a janela dele esteve em primeiro plano — ver
// runForegroundCheckTick e gameCatalog.detectGenericGameFromPath. Vale
// enquanto o processo continuar rodando (checado em runGameCheckTick).
// Formato: { label, processNames: string[], antiCheat } | null
let genericDetectedGame = null
// Nome(s) de processo que a gente está de olho pra saber quando a pessoa
// FECHOU o jogo/app que estava compartilhando em modo tela cheia (ver
// watchedProcessWasSeen logo abaixo e o bloco "screen-share-sources" mais
// adiante) — generalização do que antes só existia pros jogos da lista
// KNOWN_GAMES.
let watchedProcessNames = []
let watchedProcessWasSeen = false
// Quantas vezes seguidas um jogo do catálogo apareceu na lista de processos
// mas sem janela de verdade (processo zumbi de anti-cheat) — evita "piscar".
let gameWindowMissStreak = 0
let gameCheckTickCount = 0

// Pega a lista de processos rodando UMA vez por verificação (a cada
// GAME_CHECK_INTERVAL_MS) e reaproveita esse resultado tanto pra detectar
// jogo conhecido (KNOWN_GAMES) quanto pra checar se um processo que
// estamos vigiando (watchedProcessNames) ainda está rodando — evitar dois
// `tasklist`/`ps` separados a cada tick.
// AUDITORIA — duas falhas reais na versão anterior (que fazia só
// `tasklist` e procurava o nome com `includes` no texto inteiro):
//  1. `tasklist` no formato padrão (tabela) CORTA o nome da imagem em 25
//     caracteres — "fortniteclient-win64-shipping.exe" (33) e
//     "valorant-win64-shipping.exe" (27) nunca batiam, então Fortnite e
//     Valorant nunca eram detectados por esse nome. O formato CSV
//     (`/fo csv /nh`) não corta nada.
//  2. `includes` num texto corrido dava falso positivo com qualquer
//     processo cujo nome TERMINA igual: "trust.exe" batia com "rust.exe",
//     "spark.exe" com "ark.exe", etc. No Windows agora a comparação é por
//     nome EXATO de processo (um Set). Fora do Windows (ps), mantemos a
//     busca por trecho de texto de antes (nomes vêm com caminho no macOS
//     e cortados em 15 caracteres no Linux).
function getRunningProcessSnapshot() {
  // Windows: lista direto do sistema (sem abrir nenhum processo e sem
  // rodar tasklist a cada 15s). tasklist só como reserva.
  if (process.platform === 'win32') {
    const procs = win32native.listProcesses()
    if (procs) {
      const names = new Set(procs.map((p) => `${p.name}.exe`))
      return Promise.resolve({ text: '', names, isWin: true })
    }
  }
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const cmd = isWin ? 'tasklist /fo csv /nh' : process.platform === 'darwin' ? 'ps -Ao comm' : 'ps -eo comm'

    exec(cmd, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null)
        return
      }
      const text = stdout.toLowerCase()
      const names = new Set()
      if (isWin) {
        for (const line of text.split(/\r?\n/)) {
          // Cada linha: "nome.exe","pid","sessão","#","memória"
          const match = /^"([^"]+)"/.exec(line)
          if (match) names.add(match[1])
        }
      }
      resolve({ text, names, isWin })
    })
  })
}

// `name` pode vir com ou sem ".exe" (KNOWN_GAMES usa com; os nomes
// vigiados vindos do renderer/scanner normalmente vêm sem).
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

// Evita que duas verificações se sobreponham.
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
    // AUDITORIA: tasklist/ps falhou nessa rodada (timeout sob carga, por
    // exemplo) — mantém o estado anterior em vez de "piscar" o status pra
    // "não jogando" por causa de uma falha isolada.
    if (!snapshot) return

    let game = detectRunningGameFromSnapshot(snapshot)
    // Fallback genérico (jogo fora do catálogo, reconhecido pela pasta da
    // loja quando esteve em primeiro plano) — só enquanto o processo
    // dele continuar existindo.
    if (!game && genericDetectedGame) {
      if (genericDetectedGame.processNames.some((n) => snapshotHasProcess(snapshot, n))) {
        game = genericDetectedGame.label
      } else {
        appendDebugLog('main', `detecção genérica: "${genericDetectedGame.label}" fechou`)
        genericDetectedGame = null
      }
    }

    // Um jogo do catálogo precisa ter JANELA de verdade (anti-cheats às vezes
    // deixam o processo pendurado sem janela depois de fechar o jogo). Confere
    // na mudança de status e depois a cada ~1 min; uma falha isolada não
    // derruba o status (só a segunda seguida).
    if (game && process.platform === 'win32') {
      const justChanged = game !== currentGame
      const periodicRecheck = gameCheckTickCount % 4 === 0
      if (justChanged || periodicRecheck) {
        const info = await getGameWindowInfo(processNamesForGameLabel(game))
        if (info) {
          gameWindowMissStreak = 0
        } else {
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
      currentGame = game
      sendToMain('game-status-changed', game)
    }

    // Se tem um processo sendo vigiado (compartilhamento de tela cheia
    // ativo) e ele SUMIU da lista depois de já termos confirmado que
    // estava rodando, avisa o renderer pra encerrar o compartilhamento
    // sozinho — ver screenShareGameHint.ts e VoiceContext.tsx.
    // AUDITORIA: se o próprio `tasklist` falhou nessa rodada (snapshot
    // null), NÃO conclui que o processo fechou — antes, uma falha isolada
    // do tasklist (timeout sob carga) encerrava o compartilhamento sozinho.
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
    // Só atualiza o "último app em primeiro plano" quando NOSSA janela não
    // está em foco — assim, no instante em que a pessoa clica em
    // "Compartilhar tela" dentro do próprio app (quando o foco já é nosso),
    // o valor guardado ainda é o do jogo/app que ela estava usando antes de
    // alternar pra cá, não o nosso próprio processo.
    if (foregroundCheckInFlight) return
    if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
      foregroundCheckInFlight = true
      try {
        const fg = await getForegroundWindowInfo()
        // Recheca o foco DEPOIS da consulta (a pessoa pode ter voltado pro
        // app nesse meio-tempo) e nunca aceita o PID do próprio app.
        if (fg && fg.pid !== process.pid && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          lastForegroundApp = fg
          // Detecção genérica: o .exe em primeiro plano mora numa pasta de
          // loja de jogos? (custo zero — o caminho já veio nessa consulta).
          const generic = gameCatalog.detectGenericGameFromPath(fg.exePath)
          if (generic && !gameCatalog.findGameByProcessName(generic.processName)) {
            if (!genericDetectedGame || genericDetectedGame.label !== generic.label) {
              appendDebugLog('main', `detecção genérica: "${generic.label}" (${generic.store}, ${generic.processName}.exe)`)
            }
            genericDetectedGame = { label: generic.label, processNames: [generic.processName], antiCheat: generic.antiCheat }
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

// Privacidade: "Mostrar o jogo que estou jogando" (Configurações →
// Privacidade). Desligado = o app nem olha a lista de processos (nada
// de consulta de processos rodando em segundo plano). Fica salvo em
// privacy-settings.json na pasta de dados do app, pra valer já na
// próxima abertura, antes mesmo da página carregar.
function privacySettingsPath() {
  return path.join(app.getPath('userData'), 'privacy-settings.json')
}

function isGameDetectionEnabled() {
  try {
    const raw = JSON.parse(fs.readFileSync(privacySettingsPath(), 'utf8'))
    return raw?.gameDetection !== false
  } catch {
    return true // sem arquivo ainda = padrão (ligado)
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

// ============================================================
// "Vigia de foco do jogo": enquanto uma transmissão de TELA CHEIA sobre um
// jogo está ativa, avisa o renderer quando a janela em primeiro plano deixa
// de ser o jogo (a transmissão mostra um aviso em vez de vazar o que está
// na tela). Só Windows.
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

// Nome legível do anti-cheat do jogo atual (ou null) — só informativo,
// pra UI explicar limitações (ex.: sobreposição exige janela sem borda).
function antiCheatForGameLabel(label) {
  if (!label) return null
  const entry = gameCatalog.findGameByName(label)
  if (entry) return gameCatalog.antiCheatLabel(entry.antiCheat)
  if (genericDetectedGame && genericDetectedGame.label === label) return gameCatalog.antiCheatLabel(genericDetectedGame.antiCheat)
  return null
}

// ============================================================
// "Compartilhar seu jogo": descobre em qual monitor está a janela do jogo e
// o título dela (pra casar com a lista do desktopCapturer), inclusive com
// o jogo em tela cheia exclusiva. Ver electron/win32native.cjs.
function ensureScanner() {
  return win32native.available()
}

// Jogos do catálogo nunca têm o processo aberto (ver win32native).
function isCatalogProcess(baseName) {
  return Boolean(gameCatalog.findGameByProcessName(baseName))
}

// Monitor em pixels físicos → coordenadas do Electron (DIP).
function physicalToDip(rect) {
  if (!rect) return null
  try {
    return screen.screenToDipRect(null, rect)
  } catch {
    return rect
  }
}

// Só Windows, best-effort: null quando não acha janela do jogo.
function getGameWindowInfo(processNames) {
  if (process.platform !== 'win32' || !processNames || processNames.length === 0) return Promise.resolve(null)
  try {
    const r = win32native.findLargestWindowForProcessNames(processNames)
    if (!r || !(r.pid > 0)) return Promise.resolve(null)
    return Promise.resolve({
      bounds: physicalToDip(r.monitor),
      windowTitle: r.title || null,
      pid: r.pid,
      // Usado só pra oferecer "Restaurar e compartilhar" com o jogo minimizado.
      hwnd: r.hwnd > 0 ? r.hwnd : null,
      // showCmd 2 = SW_SHOWMINIMIZED (minimizado de verdade, diferente de
      // tela cheia exclusiva).
      isMinimized: r.showCmd === 2,
    })
  } catch {
    return Promise.resolve(null)
  }
}

// ============================================================
// Janela em primeiro plano (qualquer app/jogo, cadastrado ou não) — base
// do atalho genérico "Compartilhar [sua janela ativa]". Chamada
// periodicamente (ver runForegroundCheckTick), porque na hora de abrir o
// seletor quem está em primeiro plano é o próprio app.
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

// ============================================================
// PID de cada janela do seletor, pela correspondência de TÍTULO — reserva
// pra "áudio só deste app" (process-audio-capture.exe) quando o HWND do
// id da fonte não resolver.
function getWindowPidMap() {
  if (process.platform !== 'win32') return Promise.resolve(new Map())
  try {
    return Promise.resolve(win32native.titlePidMap())
  } catch {
    return Promise.resolve(new Map())
  }
}

// Casar pelo TÍTULO (acima) tem um problema real: o `desktopCapturer.getSources()`
// tira uma "foto" do título de cada janela num instante, e getWindowPidMap()
// roda um pouco DEPOIS — se o jogo mostra qualquer
// coisa dinâmica no título (FPS, pontuação, nome da fase), os dois textos
// já não batem mais e o casamento falha silenciosamente (era exatamente
// isso que causava "não consegui identificar o processo dessa janela" —
// confirmado, é o aviso que apareceu de verdade no teste). A alternativa
// abaixo não depende de título NENHUM: no Windows, o `id` de uma fonte do
// tipo "window" do desktopCapturer vem no formato "window:<HWND>:0" — o
// número É o handle de janela nativo de verdade (comportamento observado
// e usado por vários projetos Electron pra correlacionar uma fonte de
// captura com APIs do Win32 diretamente, já que o Electron não expõe
// isso por uma API própria). Extraindo esse número, dá pra perguntar o
// PID direto pro Windows (GetWindowThreadProcessId) sem precisar casar
// texto nenhum. Mantém getWindowPidMap() acima como fallback só pro caso
// (raro) desse formato de id não bater com o esperado nalguma versão do
// Electron.
function parseHwndFromSourceId(id) {
  const match = /^window:(\d+):/.exec(id || '')
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

// PID direto pelo HWND do id da fonte ("window:<HWND>:0").
function getPidsForWindowHandles(hwnds) {
  if (process.platform !== 'win32' || !hwnds || hwnds.length === 0) return Promise.resolve(new Map())
  try {
    return Promise.resolve(win32native.pidsForWindowHandles(hwnds))
  } catch {
    return Promise.resolve(new Map())
  }
}

// Casa os limites (bounds) devolvidos acima com um dos monitores que o
// Electron enxerga (screen.getAllDisplays()) — comparando o CENTRO da
// janela do jogo em vez das bordas exatas, porque bounds vindos de
// fontes diferentes (WinForms vs. Electron) às vezes têm 1-2px de
// diferença de arredondamento entre telas com escalas diferentes (DPI).
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

// Recebe os nomes de processo diretamente (não mais um label do
// KNOWN_GAMES) — generalização pro caso de "compartilhar seu jogo" cair
// num jogo/app não cadastrado (ver getForegroundWindowInfo acima e o
// bloco "screen-share-sources" mais adiante, que monta essa lista tanto
// pro caso conhecido — via processNamesForGameLabel — quanto pro
// genérico).
function startForegroundWatch(processNames) {
  stopForegroundWatch()
  if (process.platform !== 'win32') return false

  foregroundWatcherGames = (Array.isArray(processNames) ? processNames : [])
    .slice(0, 32)
    .map((n) => String(n).toLowerCase())
    .filter(Boolean)
  if (foregroundWatcherGames.length === 0) return false

  // Laço leve dentro do próprio app (antes era um PowerShell oculto).
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
      // já pode ter morrido sozinho — sem problema
    }
    foregroundWatcherProc = null
  }
  foregroundWatcherGames = []
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

// Sobreposição dentro de jogos — janela transparente, sem borda,
// sempre por cima, que só mostra quem está na call, quem tá falando e
// se você está mudo/ensurdecido. Fica "clique-através" (ignora o mouse)
// o tempo todo, porque não tem nenhum botão nela — é só informação, pra
// não atrapalhar o jogo. Também NUNCA recebe foco (focusable: false +
// showInactive), senão tirava o jogo de primeiro plano.
//
// LIMITAÇÃO CONHECIDA (e não contornável sem injeção): funciona com o
// jogo em JANELA SEM BORDA (borderless/"tela cheia em janela"), que é o
// padrão da maioria dos jogos atuais no Windows 10/11. Em tela cheia
// EXCLUSIVA (DirectX exclusivo) o jogo toma a tela e nenhuma janela
// normal aparece por cima — ferramentas que desenham ali fazem isso
// INJETANDO código/hook de DirectX no processo do jogo, o que é
// exatamente o que anti-cheats de kernel (Vanguard, EAC, BattlEye,
// Ricochet, FACEIT) bloqueiam/punem. O Mamacos Voip NUNCA injeta nada;
// por isso a UI orienta "use modo janela sem borda" (ver
// OverlaySettingsButton em VoiceChannelView.tsx).
//
// Posição configurável (cantos), salva em overlay-settings.json na
// pasta de dados do app.
const OVERLAY_WIDTH = 240
const OVERLAY_HEIGHT = 420
const OVERLAY_MARGIN = 24
const OVERLAY_CORNERS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
let overlaySettingsCache = null

function overlaySettingsPath() {
  return path.join(app.getPath('userData'), 'overlay-settings.json')
}

function loadOverlaySettings() {
  if (overlaySettingsCache) return overlaySettingsCache
  let corner = 'top-left'
  try {
    const raw = JSON.parse(fs.readFileSync(overlaySettingsPath(), 'utf8'))
    if (raw && OVERLAY_CORNERS.has(raw.corner)) corner = raw.corner
  } catch {
    // sem arquivo ainda / corrompido — usa o padrão
  }
  overlaySettingsCache = { corner }
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

// Monitor onde o jogo está (última janela em primeiro plano fora do app)
// — quem joga no monitor secundário quer a sobreposição LÁ, não no
// principal. Sem essa informação, usa o monitor principal.
function overlayTargetDisplay() {
  try {
    const b = lastForegroundApp?.bounds
    if (b && b.width > 0 && b.height > 0) return screen.getDisplayMatching(b)
  } catch {
    // cai pro principal
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
  if (!overlay.webContents.isLoading()) overlay.webContents.send('overlay:settings', { corner })
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
      // Sobreposição escondida não precisa gastar CPU; visível ela só
      // redesenha quando o estado muda (ver overlay.html).
      backgroundThrottling: true,
      spellcheck: false,
    },
  })
  // 'screen-saver' é o nível mais alto de "sempre por cima" que o
  // Electron oferece — fica acima de jogos em janela sem borda (que
  // costumam se colocar como topmost também).
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setIgnoreMouseEvents(true)
  // NÃO aparecer na captura de tela: sem isso, quem transmite a TELA
  // INTEIRA mandava a própria sobreposição (nomes/avatares da call) no
  // stream. No Windows 10 2004+ isso vira WDA_EXCLUDEFROMCAPTURE (a
  // janela some da captura, mas continua visível na tela de quem joga).
  try {
    overlay.setContentProtection(true)
  } catch {
    // plataforma sem suporte — segue sem
  }
  overlay.loadFile(path.join(__dirname, 'overlay.html'))
  // Assim que a página da sobreposição carregar, já entrega o último
  // estado conhecido da call (ver lastOverlayState/ensureOverlayWindow).
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

// Alguns jogos em janela sem borda se recolocam como "topmost" ao ganhar
// foco e acabam cobrindo a sobreposição. Enquanto ela estiver visível,
// reafirma a posição no topo a cada poucos segundos — moveTop() é uma
// única chamada SetWindowPos, custo desprezível.
function startOverlayTopmostKeeper() {
  stopOverlayTopmostKeeper()
  overlayTopmostTimer = setInterval(() => {
    if (!overlayVisible || !overlayWindow || overlayWindow.isDestroyed()) return
    try {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
      overlayWindow.moveTop()
    } catch {
      // janela fechando
    }
  }, 4000)
}

function stopOverlayTopmostKeeper() {
  if (overlayTopmostTimer) clearInterval(overlayTopmostTimer)
  overlayTopmostTimer = null
}

function setOverlayVisible(visible) {
  overlayVisible = Boolean(visible)
  if (overlayVisible) {
    const overlay = ensureOverlayWindow()
    applyOverlayPlacement(overlay)
    // Se a página já carregou, manda o estado mais recente agora (ele
    // pode ter mudado enquanto ela estava escondida); se ainda está
    // carregando, o 'did-finish-load' em createOverlayWindow entrega.
    if (!overlay.webContents.isLoading() && lastOverlayState !== null) {
      overlay.webContents.send('overlay:voice-state', lastOverlayState)
    }
    overlay.showInactive()
    overlay.setAlwaysOnTop(true, 'screen-saver')
    startOverlayTopmostKeeper()
  } else {
    stopOverlayTopmostKeeper()
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
  }
  appendDebugLog('main', `overlay: ${overlayVisible ? 'ligada' : 'desligada'} (canto=${loadOverlaySettings().corner})`)
  sendToMain('overlay:visibility-changed', overlayVisible)
}

// AUDITORIA — desempenho: antes a janela da sobreposição era criada
// SEMPRE ao abrir o app, mesmo pra quem nunca aperta Ctrl+Shift+O — uma
// janela transparente a mais = um processo de renderização a mais do
// Chromium (dezenas de MB de RAM + tempo de inicialização) só pra ficar
// escondida. Agora ela só nasce na primeira vez que for mostrada, e o
// último estado da call fica guardado aqui pra ela já abrir atualizada.
let lastOverlayState = null

function ensureOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow()
  }
  return overlayWindow
}

// Reconquista o foco da janela principal depois que o Windows rouba ele
// sozinho ao iniciar a captura de uma janela específica pro
// compartilhamento de tela. Um simples `.focus()` costuma ser IGNORADO
// pelo Windows nesse cenário: por padrão, o sistema tem uma proteção
// contra "roubo de foco" (foreground lock) que impede um processo em
// segundo plano de se colocar em primeiro plano à força — exatamente o
// caso aqui, já que quem tecnicamente trouxe a outra janela pra frente
// foi o próprio Windows, não um clique da pessoa dentro do nosso app.
// `setAlwaysOnTop(true)` contorna essa proteção (fica temporariamente
// "sempre visível", o que o Windows permite mesmo em segundo plano) e
// depois desliga de novo pra não travar a janela por cima de tudo pro
// resto da sessão.
function forceFocusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(false)
}

// Dispara a reconquista de foco em alguns momentos diferentes — não dá
// pra saber com certeza QUANDO o Windows vai focar a outra janela (pode
// ser na hora de resolver o pedido de captura, ou só um instante depois,
// quando o primeiro frame de vídeo realmente começa a fluir), então
// tenta de novo em alguns intervalos curtos pra cobrir os dois casos.
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
    show: false, // só aparece quando o conteúdo estiver pronto (troca suave com a splash)
    // Barra de título nativa do Windows era fina, cinza/neutra e não
    // tinha nada a ver com a cara do app (nem dava pra deixar maior ou
    // com a cor do tema). Escondendo ela e usando titleBarOverlay, os
    // botões de minimizar/maximizar/fechar continuam nativos (sem
    // precisar reimplementar isso na mão com IPC), mas sobra uma faixa
    // arrastável em cima que o React preenche com o ícone + nome do app
    // (ver TitleBar.tsx) do tamanho e cor que a gente quiser — é o que
    // corrige o "barra tem que ser maior e ficar em cima" do pedido.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#171516',
      symbolColor: '#f3efee',
      height: 40,
    },
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

  // Ctrl+Shift+I: sempre em desenvolvimento; no app INSTALADO só quando
  // ele foi aberto com `--devtools` ou com a variável MAMACOS_DEVTOOLS=1
  // (DevTools aberto dá acesso direto à sessão/tokens da conta — não
  // pode estar a um atalho de distância de qualquer pessoa na máquina).
  //
  // (Histórico) DÉCIMA QUARTA RODADA: Ctrl+Shift+I abria o DevTools mesmo no
  // build EMPACOTADO (antes só existia em desenvolvimento, via
  // openDevTools acima) — só pra diagnóstico à distância mesmo, sem essa
  // válvula de escape nenhum erro no console (ex.: por que a captura de
  // áudio por processo ou o fallback de áudio de sistema falharam) fica
  // visível pra quem está rodando o app já instalado, e todo esse tipo
  // de bug vira "só não funciona, sem pista nenhuma do motivo" pra
  // qualquer pessoa fora de quem tem acesso ao código-fonte.
  const devToolsAllowed =
    isDev || process.argv.includes('--devtools') || process.env.MAMACOS_DEVTOOLS === '1'
  win.webContents.on('before-input-event', (_event, input) => {
    if (!devToolsAllowed) return
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })

  // Se o arquivo/página falhar ao carregar (ex: caminho errado, arquivo
  // ausente), mostra um alerta nativo do sistema automaticamente — sem
  // isso, uma falha de carregamento vira só uma tela preta muda, sem
  // nenhuma pista visível de por que.
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return // ERR_ABORTED — comum durante navegação normal, não é erro de verdade
    // AUDITORIA: esse evento também dispara pra IFRAMES (ex.: uma
    // prévia de link/vídeo embutido que falhou ao carregar) — antes
    // isso abria uma caixa de erro nativa "falha ao carregar" por causa
    // de um pedaço irrelevante da página. Só a página principal importa.
    if (!isMainFrame) return
    dialog.showErrorBox(
      'Mamacos Voip — falha ao carregar',
      `Código: ${errorCode}\nDescrição: ${errorDescription}\nCaminho: ${validatedURL}`,
    )
  })

  // Se a página carregar mas travar depois (aba/processo interno
  // morreu), avisa também — outro jeito comum de "tela preta muda".
  // AUDITORIA: antes só mostrava o alerta e deixava a janela PRETA pra
  // sempre (só reiniciando o app inteiro pela bandeja). Agora recarrega a
  // página sozinho depois do aviso — com um limite, pra não entrar num
  // laço infinito de "trava → recarrega → trava" se o problema for
  // permanente.
  //
  // CORREÇÃO (crash ao compartilhar a tela inteira): o aviso era um
  // dialog.showErrorBox — MODAL e bloqueante (a pessoa precisava clicar em
  // OK antes de qualquer coisa, e o reload só acontecia depois). Agora a
  // recuperação é automática e imediata (recarrega a página na hora) e o
  // aviso é uma notificação do sistema, não bloqueante. A caixa modal só
  // aparece se o renderer continuar morrendo em sequência (3 vezes em
  // menos de 2 minutos) — aí recarregar de novo não adianta e a pessoa
  // precisa saber. Tudo continua indo pro mamacos-debug.log, junto com o
  // que o renderer estava fazendo logo antes (ver os logDebug do
  // compartilhamento de tela em VoiceContext.tsx).
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
      // notificação é só um aviso — sem ela o app já se recuperou igual
    }
  })

  // Bloqueia navegação pra qualquer lugar que não seja o próprio app —
  // se algo tentar redirecionar a janela (XSS, link malicioso, etc.),
  // isso é barrado aqui e a URL abre no navegador do sistema, fora do
  // contexto privilegiado do Electron.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
      openExternalSafely(url)
    }
  })

  // Links externos (ex: um convite colado em outro app) abrem no
  // navegador padrão do sistema, não dentro da janela do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  // Minimizar/fechar a janela vai pra bandeja do sistema em vez de
  // sumir da barra de tarefas ou encerrar o app — igual a apps de chat populares de
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
  // AUDITORIA: no Windows, ao desligar/reiniciar/sair da conta, o 'close'
  // acima (que só esconde a janela) fazia o app "segurar" o desligamento
  // — o Windows mostrava "Mamacos Voip está impedindo o desligamento".
  win.on('session-end', () => {
    isQuitting = true
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
    // "Ferramentas do desenvolvedor" e "Abrir pasta de logs" (que
    // ficavam aqui, entre os dois separadores) foram removidas do menu
    // da bandeja a pedido — quem quiser esses caminhos de diagnóstico
    // ainda consegue: Ctrl+Shift+I (ver before-input-event mais acima)
    // continua abrindo o DevTools, e o arquivo mamacos-debug.log (ver
    // debugLogPath/appendDebugLog perto do topo do arquivo) continua
    // sendo escrito normalmente na pasta de dados do app — só não tem
    // mais atalho direto pra pasta dele aqui no menu.
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

// Alguém tentou abrir o app de novo (atalho, ícone da área de trabalho,
// menu iniciar) enquanto essa instância já estava rodando — graças ao
// requestSingleInstanceLock() lá no topo do arquivo, só ESSA instância
// (a primeira, "de verdade") recebe esse evento; a segunda tentativa já
// se fechou sozinha. Em vez de deixar abrir outra janela, restaura (se
// estiver minimizada) e traz a janela existente pra frente — inclusive
// se ela estiver escondida na bandeja (hide(), não destruída), já que
// ---- Armazenamento cifrado da sessão (B7) ----
// Ver os handlers "secure-storage:*" em app.whenReady().
const SECURE_STORAGE_FILE = 'secure-session.json'
const SECURE_STORAGE_KEY_PATTERN = /^sb-[A-Za-z0-9._-]{1,200}$/
const SECURE_STORAGE_MAX_VALUE = 512 * 1024
let secureStoreCache = null

function isValidSecureStorageKey(key) {
  return typeof key === 'string' && SECURE_STORAGE_KEY_PATTERN.test(key)
}

function isSecureStorageAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    // No Linux sem chaveiro o Electron cai no backend "basic_text", que
    // é só ofuscação com uma senha fixa — trata como indisponível.
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

// Grava de forma atômica (arquivo temporário + rename) pra um
// desligamento no meio da escrita não corromper a sessão.
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

// forceFocusMainWindow() já cuida de mostrar + contornar a proteção do
// Windows contra roubo de foco.
app.on('second-instance', (_event, argv) => {
  // Windows/Linux entregam o link de volta do login do Google assim:
  // como o app já estava aberto, o clique no link "abre outra
  // tentativa" que cai aqui em vez de virar janela nova — o link vem
  // dentro desses argumentos de linha de comando.
  // AUDITORIA: tratado ANTES da checagem de janela — se a segunda
  // tentativa chegasse durante a abertura (janela ainda não criada), o
  // link se perdia; handleAuthDeepLink já guarda como pendente nesse caso.
  const deepLink = findAuthDeepLinkInArgv(argv)
  if (deepLink) handleAuthDeepLink(deepLink)

  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  forceFocusMainWindow()
})

app.whenReady().then(() => {
  // Serve os arquivos de dist/ através do protocolo "app://" — é isso
  // que substitui o antigo win.loadFile(file://...) e resolve o
  // bloqueio silencioso de módulos JS do Chromium.
  if (!isDev) {
    protocol.handle('app', async (request) => {
      let pathname
      try {
        const parsedUrl = new URL(request.url)
        // Só existe um "host" legítimo (app://bundle/...) — qualquer outro
        // é recusado em vez de servir os mesmos arquivos sob outra origem.
        if (parsedUrl.host !== 'bundle') return new Response('Not Found', { status: 404 })
        // decodeURIComponent LANÇA exceção com "%" malformado (ex.:
        // "/%E0%A4%A") — antes isso estourava dentro do handler.
        pathname = decodeURIComponent(parsedUrl.pathname)
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
      if (pathname === '' || pathname === '/') pathname = '/index.html'
      const filePath = path.join(DIST_DIR, pathname)

      // Nunca serve nada fora da pasta dist/ (evita path traversal tipo "../../../etc/passwd").
      // AUDITORIA: a checagem antiga era `filePath.startsWith(DIST_DIR)`,
      // que deixava passar pastas IRMÃS com o mesmo prefixo — um
      // "..%2fdist-qualquer/arquivo" (a barra codificada só vira "/"
      // DEPOIS do decodeURIComponent, então o parser de URL não a
      // normaliza) resolvia pra ".../dist-qualquer/arquivo", que começa
      // com ".../dist" e passava. path.relative resolve isso de vez.
      const relative = path.relative(DIST_DIR, filePath)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || filePath.includes('\0')) {
        return new Response('Forbidden', { status: 403 })
      }
      const response = await net.fetch(pathToFileURL(filePath).toString())
      // B4 — a CSP vai como CABEÇALHO (vale desde o primeiro byte, ao
      // contrário de uma <meta>, e não afeta o site na web). Só páginas
      // HTML precisam dela.
      if (!/\.html?$/i.test(filePath)) return response
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY)
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    })
  }

  // O app web pede permissão de microfone/câmera/compartilhamento de tela
  // via getUserMedia/getDisplayMedia — sem isso o Electron bloqueia por
  // padrão e a Fase 8 (voz) não funcionaria dentro do app desktop.
  // Essas são TODAS as permissões que o app já vai pedir, aceitas de
  // uma vez aqui na configuração do processo principal — qualquer
  // permissão fora dessa lista (geolocalização, sensores, etc.) é
  // negada por padrão, mesmo que algum código tente pedir.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    // "fullscreen" precisa estar aqui pro botão de tela cheia da
    // transmissão funcionar — sem ela, o navegador nega o pedido de
    // element.requestFullscreen() em silêncio (sem erro nenhum no
    // console), e o botão simplesmente não fazia nada.
    // clipboard-sanitized-write: sem ela, navigator.clipboard.writeText()
    // falhava no app ("Copiar link" dava erro).
    const allowed = ['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']
    // AUDITORIA: antes a permissão era concedida pra QUALQUER origem que
    // pedisse (inclusive um iframe de terceiros embutido numa mensagem,
    // que ganharia microfone/câmera/captura de tela sem perguntar nada).
    // Agora só a própria página do app (app://bundle ou o Vite em dev).
    let requestingUrl = ''
    try {
      requestingUrl = details?.requestingUrl || webContents?.getURL() || ''
    } catch {
      requestingUrl = ''
    }
    callback(allowed.includes(permission) && isAllowedNavigation(requestingUrl))
  })

  // OITAVA RODADA — mudança de arquitetura importante: esse trecho inteiro
  // ANTES vivia dentro de session.defaultSession.setDisplayMediaRequestHandler
  // (a API "moderna" do Electron pra intermediar getDisplayMedia). Depois
  // de VÁRIAS rodadas trocando só os detalhes das constraints de vídeo e
  // áudio sem NENHUMA mudança no erro "Invalid capture constraints
  // (AbortError)" — sempre a mesma mensagem, palavra por palavra, não
  // importa o que mudasse — pesquisei a fundo (issues oficiais do
  // electron/electron, documentação atual, como ferramentas de terceiros
  // fazem isso) e a pista mais forte que achei: setDisplayMediaRequestHandler
  // é uma API relativamente nova, com um histórico real de bugs em casos
  // de borda (existem vários issues abertos no repositório oficial do
  // Electron sobre esse handler engasgando/travando em situações
  // específicas). Já que a mensagem de erro NUNCA mudava por mais que eu
  // mexesse nos valores passados pro getDisplayMedia() do lado do
  // renderer, a suspeita mais forte deixou de ser "algum valor de
  // constraint está errado" e passou a ser "o problema está no mecanismo
  // do setDisplayMediaRequestHandler em si, não em nada que eu esteja
  // configurando".
  //
  // A partir de agora, ELIMINEI esse mecanismo por completo — em vez
  // disso, uso o jeito MAIS ANTIGO e mais testado do Electron pra capturar
  // tela/janela: desktopCapturer.getSources() (que já usávamos) +
  // navigator.mediaDevices.getUserMedia() do lado do renderer com a
  // constraint clássica "mandatory: { chromeMediaSource: 'desktop',
  // chromeMediaSourceId }" (ver toggleScreenShare/switchScreenShareSource
  // em VoiceContext.tsx). Esse é o padrão usado há anos por várias
  // ferramentas de terceiros que empacotam Electron (ex.: ToDesktop) e por
  // apps abertos como o Rocket.Chat — não é mais o exemplo OFICIAL da
  // documentação atual do Electron (que recomenda
  // setDisplayMediaRequestHandler), mas continua funcionando, é mais
  // simples, e — o mais importante — não depende NENHUM POUCO do
  // mecanismo que suspeito ser a causa real do travamento.
  //
  // Esse handler agora só PREPARA a lista de fontes (telas/janelas com
  // miniatura + a sugestão de "Jogo") e devolve isso DIRETO pra quem
  // pediu, via ipcMain.handle comum — sem callback pendente, sem
  // setDisplayMediaRequestHandler, sem esperar getDisplayMedia() decidir
  // nada. O ScreenSharePicker.tsx passou a PEDIR essa lista ativamente
  // (em vez de esperar um evento chegar sozinho) assim que a pessoa clica
  // em "Compartilhar tela".
  handleTrusted('screen-share:get-sources', async () => {
    try {
      // DESEMPENHO: as consultas ao Windows (qual é o jogo, PID de cada
      // janela pelo título) não dependem da lista de fontes — começam JÁ,
      // em paralelo com o getSources(), em vez de esperar ele terminar.
      const gameLabelAtOpen = currentGame
      // Teto de espera: o seletor abre mesmo se a consulta ao Windows
      // demorar — só sem a sugestão de jogo / áudio por app nessa vez.
      const capped = (promise, fallback) =>
        Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), 2500))])
      const gameInfoPromise = gameLabelAtOpen
        ? capped(getGameWindowInfo(processNamesForGameLabel(gameLabelAtOpen)), null)
        : Promise.resolve(null)
      const titlePidMapPromise = capped(getWindowPidMap(), new Map())
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 200 },
        // AUDITORIA: os ícones de janela (appIcon) nunca eram enviados pro
        // renderer (ver o `sources.map` no retorno abaixo) — pedir eles só
        // gastava tempo extra do Windows a cada abertura do seletor.
        fetchWindowIcons: false,
      })
      // Em telas múltiplas, precisamos saber qual delas é a PRINCIPAL —
      // sem isso, o atalho "Compartilhar seu jogo" (quando cai no
      // fallback de tela cheia — ver ScreenSharePicker.tsx) só pegava a
      // primeira tela que o Windows devolvesse nessa lista, que nem
      // sempre é onde o jogo está de fato rodando. Como a maioria de
      // quem joga com dois monitores usa o principal pro jogo e o
      // secundário pra navegador/chat, ir direto na principal é
      // a aposta mais segura — bem melhor do que arriscar compartilhar
      // sem querer a tela com as conversas abertas.
      let primaryDisplayId = null
      try {
        primaryDisplayId = String(screen.getPrimaryDisplay().id)
      } catch {
        // sem problema, só não vai ter como marcar qual é a principal
      }
      // Qual é a janela do jogo (catálogo) — ou, sem jogo do catálogo, a
      // última janela em primeiro plano antes de clicar em "Compartilhar".
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

      // PID de CADA janela visível na lista, não só a sugerida — é o que
      // permite oferecer "áudio só deste app" pra qualquer janela que a
      // pessoa escolher (ver "Captura de áudio por processo" em
      // VoiceContext.tsx). Método principal: extrai o HWND do próprio id
      // do desktopCapturer (ver parseHwndFromSourceId acima — não
      // depende de título, muito mais confiável); getWindowPidMap
      // (casamento por título) só entra como reserva pras poucas janelas
      // em que isso falhar.
      const windowHwnds = sources
        .filter((s) => s.id.startsWith('window:'))
        .map((s) => parseHwndFromSourceId(s.id))
        .filter((h) => h !== null)
      const [hwndPidMap, titlePidMap] = await Promise.all([capped(getPidsForWindowHandles(windowHwnds), new Map()), titlePidMapPromise])

      let gameDisplayId = matchDisplayIdForBounds(windowInfo?.bounds ?? null)
      // SÉTIMA RODADA: quando tem um jogo CADASTRADO (KNOWN_GAMES) rodando
      // mas NENHUM dos métodos acima achou a janela/bounds dele (comum em
      // jogo de tela cheia EXCLUSIVA de verdade — pode nem aparecer pro
      // desktopCapturer como janela capturável, e pode estar minimizado
      // bem no instante de abrir esse seletor, que é exatamente quando a
      // pessoa alternou pra fora dele) — se só existe UM monitor no
      // sistema, não tem ambiguidade nenhuma sobre onde o jogo está: só
      // pode ser ali. Isso dá uma sugestão de "Jogo" funcional mesmo
      // quando a varredura de janela falha por completo, pro caso mais
      // comum (a maioria de quem joga tem 1 monitor só).
      const screenSources = sources.filter((s) => s.id.startsWith('screen:'))
      if (!gameDisplayId && currentGame && screenSources.length === 1) {
        gameDisplayId = screenSources[0].display_id
        isKnownGame = true
        suggestionLabel = currentGame
        if (watchProcessNamesForShare.length === 0) {
          watchProcessNamesForShare = processNamesForGameLabel(currentGame)
        }
      }
      // DÉCIMA RODADA: a mesma lacuna acima, generalizada pra quem tem
      // MAIS de um monitor — antes disso, se um jogo CADASTRADO estava
      // rodando mas a varredura de janela falhou (tela cheia exclusiva de
      // verdade, sem MainWindowHandle nenhum pro Windows achar — ou o
      // a consulta simplesmente não deu tempo), a sugestão "Jogo"
      // desaparecia por completo pra quem tem 2+ monitores (o caso mais
      // comum é justamente jogo no monitor principal + chat/mamaco no
      // secundário, exatamente o setup que esse recado do topo do
      // arquivo já descreve). Sem saber em qual monitor o jogo está,
      // apostar no monitor PRINCIPAL ainda é bem melhor do que não
      // sugerir nada — a pessoa sempre pode escolher a tela certa na mão
      // pela seção "Tela cheia" se o palpite errar.
      if (!gameDisplayId && currentGame && primaryDisplayId) {
        gameDisplayId = primaryDisplayId
        isKnownGame = true
        suggestionLabel = currentGame
        if (watchProcessNamesForShare.length === 0) {
          watchProcessNamesForShare = processNamesForGameLabel(currentGame)
        }
      }
      const gameWindowTitle = windowInfo?.windowTitle ?? null
      const gameWindowPid = windowInfo?.pid ?? null
      // Resolve o PID de cada janela ANTES de montar a lista final —
      // precisamos dele tanto pro campo `pid` de cada fonte (já existia)
      // quanto, a partir de agora, pra decidir `isExactGameWindow` (ver
      // abaixo).
      const resolvedPidBySourceId = new Map(
        sources
          .filter((s) => s.id.startsWith('window:'))
          .map((s) => [s.id, hwndPidMap.get(parseHwndFromSourceId(s.id)) ?? titlePidMap.get(s.name) ?? null])
      )
      // VIGÉSIMA QUINTA RODADA — bug real relatado com print de tela:
      // Rainbow Six Siege rodando em TELA CHEIA EXCLUSIVA (não
      // minimizado de verdade — a pessoa estava jogando) aparecia como
      // "está minimizado, restaure a janela" mesmo assim. A causa
      // original: um jogo em modo exclusivo de verdade tem o MESMO sinal
      // INDIRETO que um jogo minimizado — GetGameWindowInfo acha o
      // HWND/PID dele, mas NENHUMA fonte do tipo "window" bate com esse
      // PID (seja porque está minimizado OU porque está em tela cheia
      // exclusiva — indistinguíveis só com esse sinal indireto).
      //
      // Uma correção anterior tentou resolver isso condicionando à
      // existência de um fallback de tela (gameDisplayId) — só que essa
      // condição sozinha criou um bug NOVO: como esse fallback quase
      // sempre acaba resolvido de um jeito ou de outro (ver os vários
      // "if (!gameDisplayId ...)" acima, incluindo o de ÚLTIMO caso que
      // cai pro monitor principal sempre que há um jogo conhecido),
      // "está minimizado" parava de aparecer até pra jogos GENUINAMENTE
      // minimizados. Precisava do sinal DIRETO, não de uma dedução.
      //
      // Esse sinal direto existe: GetWindowPlacement (ver
      // findLargestWindowForProcessNames em win32native.cjs) já devolve showCmd,
      // que diz exatamente se a janela está minimizada de verdade
      // (SW_SHOWMINIMIZED) — sem precisar adivinhar nada a partir de
      // fontes de tela disponíveis ou não. Ver getGameWindowInfo acima
      // (windowInfo.isMinimized).
      const gameWindowHwnd = windowInfo?.hwnd ?? null
      const hasCapturableGameWindow =
        gameWindowPid !== null &&
        sources.some((s) => s.id.startsWith('window:') && resolvedPidBySourceId.get(s.id) === gameWindowPid)
      const looksMinimized =
        isKnownGame &&
        gameWindowHwnd !== null &&
        gameWindowPid !== null &&
        !hasCapturableGameWindow &&
        windowInfo?.isMinimized === true

      // OITAVA RODADA: devolve o payload DIRETO como retorno do
      // ipcMain.handle (em vez de mandar por webContents.send pra um
      // listener que já estava esperando) — o formato de cada item e da
      // sugestão continua exatamente igual, só a forma de ENTREGAR mudou.
      return {
        sources: sources.map((s) => {
          const pid = s.id.startsWith('window:') ? resolvedPidBySourceId.get(s.id) ?? null : null
          return {
            id: s.id,
            name: s.name,
            // JPEG em vez de PNG: codifica bem mais rápido e manda ~5x
            // menos dados pro renderer com dezenas de janelas abertas.
            thumbnail: s.thumbnail.isEmpty()
              ? ''
              : `data:image/jpeg;base64,${s.thumbnail.toJPEG(75).toString('base64')}`,
            // O id que o desktopCapturer devolve sempre começa com "screen:" ou
            // "window:" (formato documentado e estável da API) — usamos esse
            // prefixo pra dizer pro renderer se cada opção é uma tela inteira ou
            // uma janela específica. Isso importa porque jogos em modo tela
            // cheia exclusiva (comum em jogos no Windows) não aparecem como uma
            // "janela" capturável — só a captura de tela inteira consegue
            // pegá-los — então o app precisa saber diferenciar as duas pra
            // oferecer o fallback certo (ver ScreenSharePicker.tsx).
            type: s.id.startsWith('screen:') ? 'screen' : 'window',
            isPrimaryDisplay: Boolean(primaryDisplayId) && s.display_id === primaryDisplayId,
            // DÉCIMA RODADA: casar por PID (via HWND, ver hwndPidMap acima)
            // em vez de só por TÍTULO — a comparação de título sozinha
            // (`s.name === gameWindowTitle`) falha sempre que o título vem
            // vazio, e isso acontece em bem mais casos do que só janela
            // borderless "de propósito": qualquer processo com um nível de
            // integridade MAIS ALTO que o do Mamacos Voip (comum em jogos
            // competitivos com anti-cheat, ex.: Valorant/Vanguard, Fortnite/
            // EasyAntiCheat, Rainbow Six/BattlEye) faz o Windows bloquear
            // GetWindowText entre processos (proteção UIPI padrão do
            // sistema) — o título chega vazio mesmo a janela tendo um de
            // verdade. GetWindowThreadProcessId (usado pra resolver `pid`
            // acima) NÃO tem essa restrição — funciona igual pra qualquer
            // processo, elevado ou não — por isso é a comparação preferida
            // agora. Título continua como plano B pro caso (raro) do PID
            // não resolver de nenhuma forma.
            isExactGameWindow:
              gameWindowPid !== null ? pid === gameWindowPid : Boolean(gameWindowTitle) && s.name === gameWindowTitle,
            isGameDisplay: Boolean(gameDisplayId) && s.display_id === gameDisplayId,
            // PID do processo dono da janela, quando dá pra descobrir (só
            // type === 'window'; uma tela inteira pode ter vários
            // processos desenhando nela, não faz sentido isolar) — usado
            // pra oferecer a captura de áudio experimental "só deste
            // app". null quando não achou (Mac/Linux, handle não resolvido
            // e título também não bateu com nenhum processo).
            pid,
          }
        }),
        suggestion: suggestionLabel
          ? {
              label: suggestionLabel,
              isKnownGame,
              processNames: watchProcessNamesForShare,
              // Cobre o caso "Jogo" caindo no fallback de tela cheia
              // (sem janela própria — ver windowInfo.pid, resolvido via
              // getGameWindowInfo/getForegroundWindowInfo acima), onde o
              // mapa por título não tem como ajudar.
              pid: windowInfo?.pid ?? null,
              // DÉCIMA OITAVA RODADA: hwnd + looksMinimized (ver acima) —
              // usados só pelo botão "Restaurar e compartilhar" do
              // ScreenSharePicker.tsx.
              hwnd: gameWindowHwnd,
              looksMinimized,
              // Só informativo (ver ScreenSharePicker.tsx): nome do
              // anti-cheat do jogo, quando conhecido. A captura continua
              // igual — nunca injetamos nada no jogo.
              antiCheat: isKnownGame ? antiCheatForGameLabel(suggestionLabel) : null,
            }
          : null,
      }
    } catch {
      // Sem callback pendente pra "recusar" aqui (não é mais
      // setDisplayMediaRequestHandler) — devolver null é suficiente:
      // ScreenSharePicker.tsx trata a ausência de fontes como "não
      // encontrei nada" e mostra o erro genérico normalmente.
      return null
    }
  })

  // Botão "Restaurar e compartilhar": desminimiza a janela do jogo (a
  // pedido da pessoa) e espera o Windows redesenhar antes da nova lista.
  // Copiar texto pela área de transferência do sistema (não depende de
  // permissão/foco do navegador).
  handleTrusted('clipboard:write-text', (_event, text) => {
    if (typeof text !== 'string' || text.length > 100_000) return false
    clipboard.writeText(text)
    return true
  })

  handleTrusted('screen-share:restore-window', async (_event, hwnd) => {
    if (process.platform !== 'win32' || !Number.isFinite(hwnd) || hwnd <= 0) return { ok: false }
    let ok = false
    try {
      ok = win32native.restoreWindow(Math.trunc(hwnd))
    } catch {
      ok = false
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
    return { ok }
  })

  // OITAVA RODADA: agora que a captura de vídeo em si acontece direto no
  // renderer via getUserMedia({ mandatory: { chromeMediaSourceId } }) —
  // ver toggleScreenShare/switchScreenShareSource em VoiceContext.tsx —
  // esse handler não precisa mais resolver callback nenhum nem reaproveitar
  // lista de fontes nenhuma. Ele só cuida do efeito colateral de foco: ao
  // escolher compartilhar uma JANELA específica, o Windows costuma trazer
  // essa janela pra frente sozinho (comportamento da própria API de
  // captura do sistema), então precisamos tentar recuperar o foco do app
  // de volta em seguida.
  handleTrusted('screen-share:select', (_event, sourceId) => {
    if (sourceId) scheduleFocusReclaim()
  })

  // NONA RODADA — caminho de emergência automático: fiz um teste real
  // (rodando o Electron de verdade, não só lendo documentação) confirmando
  // que TANTO o caminho antigo (getUserMedia + chromeMediaSourceId, usado
  // acima) QUANTO o caminho moderno (getDisplayMedia +
  // setDisplayMediaRequestHandler, abandonado na rodada anterior)
  // funcionam perfeitamente nesse ambiente de teste — ou seja, nenhum dos
  // dois está quebrado no Electron/Chromium em si. Se ainda assim o erro
  // "Invalid capture constraints" persistir só no computador de alguém, é
  // sinal de algo BEM específico daquele Windows (driver de vídeo,
  // anti-cheat de um jogo específico, política de segurança) que afeta um
  // dos dois caminhos mas não necessariamente o outro.
  //
  // Por isso: se o caminho principal (getUserMedia) falhar por QUALQUER
  // motivo que não seja a pessoa cancelar, VoiceContext.tsx agora tenta
  // AUTOMATICAMENTE o caminho antigo (getDisplayMedia) como plano B, sem
  // pedir pra escolher de novo — usando a MESMA fonte já escolhida. Esse
  // handler "fixa" qual fonte vai ser usada assim que o plano B disparar o
  // pedido de getDisplayMedia (ver 'screen-share:pin-fallback-source'
  // logo abaixo).
  // DÉCIMA PRIMEIRA RODADA — bug real relatado com print de tela: no Linux
  // (testado com Wayland — a bem provável causa, dado o visual do
  // sistema no print), o seletor customizado (ScreenSharePicker.tsx,
  // baseado em desktopCapturer.getSources()) só listava a JANELA DO
  // PRÓPRIO Mamacos Voip — nem o navegador aberto, nem o jogo, apareciam
  // na grade de "Janela", mesmo com essas janelas abertas e visíveis.
  //
  // O motivo é estrutural, não um bug de código: no Wayland, por design
  // de segurança do próprio protocolo, um app comum NÃO tem permissão de
  // enumerar as janelas de outros processos sozinho — só o compositor
  // (GNOME/KDE/etc.) sabe quais janelas existem e pode desenhar
  // miniaturas delas. Pra resolver isso, existe o "portal" do sistema
  // (xdg-desktop-portal, seção ScreenCast) — é ELE quem mostra um
  // seletor NATIVO (de verdade do sistema operacional, fora do controle
  // do Electron) com as miniaturas de tudo que está aberto, e só devolve
  // pro app o que a PESSOA escolheu ali. desktopCapturer.getSources() no
  // Wayland ou já dispara esse portal sozinho (te devolvendo só a escolha
  // feita nele, não uma lista completa pra montar uma UI própria) ou, em
  // compositores mais restritos, simplesmente não enxerga outras janelas
  // — daí sobrar só "Mamacos Voip" (a própria janela do app, que o
  // Electron sempre enxerga por ser o processo dono dela).
  //
  // É exatamente esse portal nativo que um app de chat popular (e qualquer app sério
  // no Linux — OBS, Zoom, o próprio Chrome) usa no Wayland: em vez de
  // tentar montar uma UI própria com a lista de janelas (como esse app
  // faz pro Windows, onde desktopCapturer.getSources() realmente devolve
  // tudo), eles chamam getDisplayMedia() e deixam o SISTEMA mostrar o
  // seletor dele — com as miniaturas de verdade de qualquer janela,
  // incluindo jogos e navegador, e com um toggle de "compartilhar
  // também o áudio" quando o compositor suporta (GNOME/KDE recentes
  // suportam). Ver o branch de Linux em captureScreenShareStream
  // (VoiceContext.tsx), que agora faz exatamente isso.
  //
  // Pra esse seletor nativo aparecer de verdade, este processo principal
  // NÃO PODE registrar um setDisplayMediaRequestHandler — registrar esse
  // handler (como já fazíamos, só como plano B pro Windows — ver NONA
  // RODADA abaixo) faz o Electron entregar CADA pedido de getDisplayMedia
  // pra gente resolver na mão, o que troca o portal nativo do sistema
  // pela nossa lista (quebrada) do desktopCapturer de novo — exatamente
  // o problema que queremos evitar aqui. Por isso esse handler (e o
  // "pino" de fallback que ele usa) só é registrado fora do Linux —
  // nessa plataforma, a ausência TOTAL de handler é o que deixa o
  // Electron/Chromium negociar com o portal do jeito nativo.
  if (process.platform !== 'linux') {
  let fallbackPinnedSourceId = null
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    // Testei isso de verdade (rodando o Electron num ambiente de teste) e
    // encontrei um bug real aqui: se `callback(...)` em si lançar uma
    // exceção internamente (ex.: a fonte resolvida não servir mais pra
    // captura — pode acontecer se outra captura já tiver "reservado" o
    // recurso), o catch chamava `callback({})` de novo — e o Electron
    // proíbe chamar esse callback mais de uma vez ("One-time callback was
    // called more than once"), o que derrubava o processo principal
    // inteiro. `respond()` garante que callback() só é chamado NO MÁXIMO
    // uma vez, não importa o que aconteça.
    let responded = false
    const respond = (value) => {
      if (responded) return
      responded = true
      try {
        callback(value)
      } catch {
        // Se mesmo essa única chamada falhar, não tem mais nada a fazer
        // — o pior caso é a Promise do getDisplayMedia() no renderer
        // ficar pendurada; por isso VoiceContext.tsx corre esse plano B
        // contra um timeout (ver captureScreenShareStream).
      }
    }
    try {
      // AUDITORIA: só atende pedidos vindos da própria página do app.
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
  } // fim do `if (process.platform !== 'linux')` — ver DÉCIMA PRIMEIRA RODADA acima

  // Segunda chamada de reforço: o renderer chama isso de novo assim que
  // o MediaStream do compartilhamento realmente começa a fluir (pode
  // acontecer um pouco depois do resolve() acima) — cobre o caso do
  // Windows focar a janela de novo nesse meio-tempo.
  onTrusted('app:focus-window', () => {
    scheduleFocusReclaim()
  })

  Menu.setApplicationMenu(null)

  const splash = createSplashWindow()
  const win = createWindow()
  createTray(win)

  win.once('ready-to-show', () => {
    if (!splash.isDestroyed()) splash.close()
    win.show()
  })

  win.webContents.once('did-fail-load', () => {
    if (!splash.isDestroyed()) splash.close()
  })
  win.webContents.once('render-process-gone', () => {
    if (!splash.isDestroyed()) splash.close()
  })

  // Se o app foi aberto DIRETO por um link de volta do login do Google
  // (app estava fechado — ver o "recado pendente" lá no topo do
  // arquivo), só entrega ele depois que a página termina de carregar,
  // senão a mensagem chegaria antes do React montar e escutar por ela.
  win.webContents.once('did-finish-load', () => {
    if (pendingAuthDeepLink) {
      const link = pendingAuthDeepLink
      pendingAuthDeepLink = null
      handleAuthDeepLink(link)
    }
  })

  // --- Overlay dentro de jogos -----------------------------------
  // AUDITORIA: a janela da sobreposição agora é criada só na primeira vez
  // que for mostrada (ver ensureOverlayWindow) — não mais aqui na abertura.

  // O app principal manda o estado atual da call pra cá sempre que
  // muda (quem tá na sala, quem tá falando, quem tá mudo). Guarda só o
  // ÚLTIMO estado (pra sobreposição já abrir atualizada) e só repassa
  // quando ela está VISÍVEL — o indicador de "falando" muda várias vezes
  // por segundo numa call, e repassar isso pra uma janela escondida era
  // trabalho jogado fora.
  onTrusted('overlay:update-state', (_event, state) => {
    lastOverlayState = state ?? null
    if (overlayVisible && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay:voice-state', lastOverlayState)
    }
  })

  // Atalho global (funciona mesmo com o jogo em foco) pra ligar/desligar
  // a sobreposição — usa o mecanismo embutido do próprio Electron
  // (não depende do módulo nativo do push-to-talk), já que só precisa
  // reagir a "tecla apertada", não "segurando ou não".
  const registered = globalShortcut.register('Control+Shift+O', () => {
    setOverlayVisible(!overlayVisible)
  })
  // Atalhos de teclado GLOBAIS (Configurações → Atalhos): funcionam com o
  // jogo em primeiro plano. O renderer manda a lista { id, accelerator };
  // cada um que dispara avisa o renderer com o id da ação. Só registra
  // os nossos — o da sobreposição (acima) fica intacto.
  let registeredKeybinds = []
  handleTrusted('keybinds:set-global', (_event, list) => {
    for (const acc of registeredKeybinds) {
      try {
        globalShortcut.unregister(acc)
      } catch {
        // já não estava registrado
      }
    }
    registeredKeybinds = []
    const failed = []
    if (!Array.isArray(list)) return { failed }
    for (const item of list.slice(0, 32)) {
      const id = typeof item?.id === 'string' ? item.id.slice(0, 40) : ''
      const acc = typeof item?.accelerator === 'string' ? item.accelerator.slice(0, 60) : ''
      if (!id || !acc || acc === 'Control+Shift+O') continue
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

  // Mesmos controles pela interface (botão da sobreposição na tela da
  // call, ver OverlaySettingsButton em VoiceChannelView.tsx).
  handleTrusted('overlay:get-settings', () => ({
    ...loadOverlaySettings(),
    visible: overlayVisible,
    shortcutRegistered: registered,
  }))
  handleTrusted('overlay:set-visible', (_event, visible) => {
    setOverlayVisible(Boolean(visible))
    return overlayVisible
  })
  handleTrusted('overlay:set-corner', (_event, corner) => {
    if (!OVERLAY_CORNERS.has(corner)) return loadOverlaySettings()
    saveOverlaySettings({ ...loadOverlaySettings(), corner })
    if (overlayWindow && !overlayWindow.isDestroyed()) applyOverlayPlacement(overlayWindow)
    return loadOverlaySettings()
  })
  if (!registered) {
    console.error('Não foi possível registrar o atalho da sobreposição (Ctrl+Shift+O) — pode já estar em uso por outro programa.')
  }

  // Ctrl+Shift+I (DevTools) NÃO é mais atalho GLOBAL do sistema: antes
  // ele era registrado com globalShortcut, ou seja, sequestrava essa
  // combinação em TODOS os programas do computador (outro app/jogo que
  // usasse Ctrl+Shift+I nunca recebia a tecla) e abria o DevTools do app
  // mesmo sem a janela em foco. Continua funcionando com a janela do app
  // focada — ver o before-input-event em createWindow.

  if (isGameDetectionEnabled()) startGameDetection()
  // Deixa a ponte nativa carregada antes do 1º "Compartilhar tela".
  if (process.platform === 'win32') setTimeout(() => void ensureScanner(), 1500)

  handleTrusted('app:getGameDetectionEnabled', () => isGameDetectionEnabled())
  handleTrusted('app:setGameDetectionEnabled', (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('valor inválido')
    return setGameDetectionEnabled(enabled)
  })
  handleTrusted('app:getVersion', () => app.getVersion())
  handleTrusted('app:getCurrentGame', () => currentGame)
  handleTrusted('app:getCurrentGameInfo', () =>
    currentGame
      ? {
          label: currentGame,
          antiCheat: antiCheatForGameLabel(currentGame),
          generic: !gameCatalog.findGameByName(currentGame),
        }
      : null
  )

  // B7 — armazenamento cifrado da sessão do Supabase (ver
  // src/lib/authStorage.ts). Antes o access/refresh token ficavam em
  // texto puro no localStorage do perfil do Electron. Agora cada valor
  // é cifrado com o safeStorage do sistema (DPAPI no Windows, Keychain
  // no macOS, libsecret/kwallet no Linux) e gravado em
  // secure-session.json na pasta de dados do app. Só chaves "sb-" (do
  // supabase-js). Sem cifragem disponível, responde { ok: false } e o
  // renderer continua usando o localStorage (nunca desloga por isso).
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

  // Ver o bloco grande "Vigia de foco do jogo" (perto de
  // startGameDetection) pra entender o que isso faz e por quê. Recebe os
  // nomes de processo diretamente agora (não mais um label do
  // KNOWN_GAMES) — ver startForegroundWatch.
  handleTrusted('game-foreground-watch:start', (_event, processNames) => startForegroundWatch(processNames))
  handleTrusted('game-foreground-watch:stop', () => {
    stopForegroundWatch()
  })

  // Auto-parar o compartilhamento de TELA CHEIA quando o jogo/app
  // compartilhado é FECHADO de vez (não só perde o foco — isso quem cuida
  // é o vigia acima) — ver watchedProcessNames/watchedProcessWasSeen no
  // laço de startGameDetection, e VoiceContext.tsx (toggleScreenShare)
  // pra como o renderer usa isso.
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

  // ============================================================
  // "Captura de áudio por processo" (EXPERIMENTAL) — pedido explícito:
  // "nao tem como focar o audio somente na janela em que estou
  // trasnmitindo?". A captura de áudio "padrão" (audio: 'loopback' lá
  // em cima) é a única coisa que o próprio Windows/Chromium oferecem
  // via getDisplayMedia() — e ela sempre pega o MIX INTEIRO do sistema
  // (todo mundo tocando som, inclusive o próprio Mamacos Voip), sem
  // como isolar. Não existe um jeito de resolver isso só com
  // JavaScript/Electron — por isso um .exe separado (ver
  // native/process-audio-capture/capture.cpp) usando a API oficial da
  // Microsoft de "Process Loopback Capture", que consegue pedir o
  // áudio de só UM processo (+ os filhos dele).
  //
  // Limitações conhecidas, avisadas por completo aqui:
  //  - Só existe no Windows 10 build 20348+ (efetivamente só Windows
  //    11 em uso comum) — em qualquer outro sistema, ou se o .exe não
  //    existir/falhar por qualquer motivo, essa opção simplesmente não
  //    aparece/não funciona, sem quebrar a captura de tela em si.
  //  - É um processo externo rodando enquanto a captura está ativa —
  //    encerrado junto com o compartilhamento de tela (ver
  //    stopProcessAudioCapture) e também ao fechar o app inteiro (ver
  //    'before-quit' mais abaixo).
  let processAudioCaptureProc = null
  let processAudioHeaderBuffer = Buffer.alloc(0)
  let processAudioHeaderParsed = false
  let processAudioPendingChunks = []
  let processAudioFlushTimer = null

  const PROCESS_AUDIO_HEADER_SIZE = 16
  const PROCESS_AUDIO_FLUSH_MS = 40

  function resolveProcessAudioCaptureExePath() {
    // Mesmo truque que o Electron builder já documenta pra qualquer
    // binário dentro de asarUnpack: dentro do pacote final, o app roda
    // de dentro de um arquivo .asar (não é uma pasta de verdade no
    // disco), mas um .exe não pode ser executado de lá — asarUnpack
    // (ver package.json) copia ele pra fora, numa pasta irmã chamada
    // "app.asar.unpacked". __dirname sozinho ainda aponta pra dentro do
    // .asar, então essa troca de texto no caminho é necessária pra
    // achar o arquivo de verdade.
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

  // (Não descartamos pedaços antigos aqui de propósito: o fluxo de PCM não
  // tem separação entre amostras, e jogar fora um pedaço de tamanho
  // arbitrário desalinharia todas as amostras seguintes — ruído puro.)
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
        // já pode ter morrido sozinho — sem problema
      }
      processAudioCaptureProc = null
    }
  }

  // `mode`:
  //  - 'include' (padrão): só o áudio da árvore de processos do PID (o jogo).
  //  - 'exclude': TODO o áudio do sistema MENOS a árvore do PID — usado com
  //    o PID do próprio app (process.pid, dono do serviço de áudio do
  //    Chromium) pra transmitir o "áudio do sistema" sem a call junto
  //    (senão quem assiste ouve a própria voz de volta = eco).
  //    Exe antigo (sem suporte a --exclude) sai com "PID invalido" e o
  //    renderer cai no loopback do Chromium, como antes.
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

      // AUDITORIA: stop() + start() em sequência rápida (trocar de janela
      // compartilhada) deixava o processo ANTIGO ainda despejando dados
      // no mesmo buffer/cabeçalho compartilhado do processo NOVO —
      // misturando o áudio dos dois ou corrompendo o cabeçalho. Tudo que
      // chega de um processo que não é mais o atual agora é ignorado.
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

      // stderr é só texto de diagnóstico (ver capture.cpp) — repassa
      // linhas "ERROR ..." pro renderer pra pelo menos dar um motivo em
      // vez de simplesmente "não funcionou". Linhas "STATUS ..." só
      // ajudam a depurar (não precisa mostrar na cara da pessoa).
      let stderrBuffer = ''
      proc.stderr?.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf8')
        // Linha gigante sem quebra (não deveria acontecer) — não deixa crescer sem limite.
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
            // Só pra esse log de diagnóstico — não precisa incomodar
            // quem está usando com isso (ver comentário original acima).
            appendDebugLog('main', `startProcessAudioCapture: ${line}`)
          }
        }
      })

      proc.on('error', (err) => {
        appendDebugLog('main', `startProcessAudioCapture: evento 'error' do processo — ${err?.message}`)
        // AUDITORIA: antes zerava a referência SEMPRE — se esse erro viesse
        // de um processo antigo, o processo novo ficava sem referência e
        // nunca mais era encerrado (nem ao fechar o app).
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

  // ============================================================
  // Fallbacks de captura de tela nativos (VIGÉSIMA TERCEIRA e TRIGÉSIMA
  // TERCEIRA RODADAS — ver os comentários grandes em
  // native/screen-capture-gdi/capture.cpp e
  // native/screen-capture-wgc/capture.cpp pro raciocínio completo de
  // cada um). Os dois falam o MESMO protocolo binário pelo stdout
  // (cabeçalho de 16 bytes + quadros JPEG com tamanho na frente), então
  // em vez de duplicar toda a lógica de spawn/parse/IPC pra cada um (o
  // que já tinha acontecido uma vez, quando só existia o GDI),
  // generalizei numa fábrica — `createNativeFrameCaptureChannel` monta
  // um canal completo (start/stop, com o parsing e os eventos de IPC)
  // a partir só do nome do .exe e do prefixo dos eventos.
  //
  // Ordem de prioridade das tentativas (ver captureScreenShareStream em
  // VoiceContext.tsx): WGC primeiro (acelerado por GPU, funciona mesmo
  // com o compositor do Windows fora do ar — é o único dos dois que
  // realmente vê um jogo em tela cheia exclusiva de verdade), GDI só
  // como último recurso final (mais garantido de existir/funcionar em
  // qualquer Windows, mas não resolve o caso de tela cheia exclusiva —
  // serve mais pra outros tipos de falha de driver).
  function createNativeFrameCaptureChannel(channelPrefix, exeFileName, expectedMagic) {
    let proc = null
    let headerBuffer = Buffer.alloc(0)
    let headerParsed = false
    // Depois do cabeçalho, cada quadro é [4 bytes de tamanho][tamanho
    // bytes de JPEG] — diferente do áudio (fluxo contínuo sem separação
    // nenhuma entre amostras), aqui É PRECISO respeitar o limite de cada
    // quadro: colar dois JPEGs sem separação não abriria como imagem
    // nenhuma do lado do renderer. Esse buffer acumula bytes até ter
    // quadro(s) COMPLETO(s) pra repassar.
    //
    // AUDITORIA — desempenho: antes cada pedaço lido do stdout (tipicamente
    // 64KB) fazia `Buffer.concat([frameBuffer, chunk])`, copiando TODO o
    // quadro parcial de novo a cada pedaço — custo quadrático por quadro
    // (um JPEG de 1MB em 16 pedaços = ~8MB copiados), na thread principal,
    // dezenas de vezes por segundo. Agora os pedaços ficam numa lista e só
    // são juntados UMA vez, quando já existe um quadro inteiro disponível.
    let pendingChunks = []
    let pendingBytes = 0
    const HEADER_SIZE = 16
    // Um JPEG de um monitor 4K em qualidade 85 fica bem abaixo de 10MB —
    // um "tamanho" acima disso só pode ser fluxo corrompido/dessincronizado,
    // e esperar por ele faria o buffer crescer sem limite.
    const MAX_FRAME_BYTES = 64 * 1024 * 1024

    function resolveExePath() {
      // Mesmo truque do resolveProcessAudioCaptureExePath (o .exe
      // precisa estar fora do .asar pra rodar de dentro do pacote final).
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
          // já pode ter morrido sozinho — sem problema
        }
        proc = null
      }
    }

    // Junta os pedaços pendentes num buffer só (quando há mais de um).
    function takePending() {
      const merged = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingBytes)
      pendingChunks = [merged]
      return merged
    }

    function drainFrames() {
      // TRIGÉSIMA QUINTA RODADA — bug relatado (com o WGC funcionando de
      // verdade agora, mostrando o jogo em vez da "foto congelada" de
      // antes): vídeo com ~3 segundos de atraso, sempre atrás do tempo
      // real. Antes desta correção, se MAIS de um quadro completo se
      // acumulasse no buffer entre uma leitura e outra (qualquer soluço
      // momentâneo no processo principal — ex.: o resto do app fazendo
      // outra coisa na mesma thread JS por um instante), TODOS eles eram
      // mandados pro renderer em sequência, mais velho primeiro — em vez
      // de descartar os antigos (que já não representam mais o "agora")
      // e mandar só o mais recente. Isso é exatamente o tipo de acúmulo
      // que gera "vídeo alguns segundos atrasado e nunca alcança o
      // presente": cada soluço pequeno empilha atraso permanente, que só
      // cresce com o tempo, nunca diminui sozinho. Já existia essa
      // mesma proteção (manter só o quadro MAIS RECENTE) dentro da
      // própria captura em C++ (ver o loop principal em
      // native/screen-capture-wgc/capture.cpp) — só faltava replicar
      // aqui também, nesta outra ponta do cano (processo principal →
      // renderer), que é onde esse acúmulo específico podia acontecer.
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
        if (buffer.length - offset < 4 + frameSize) break // quadro ainda incompleto, espera mais dados
        latestFrame = buffer.subarray(offset + 4, offset + 4 + frameSize)
        offset += 4 + frameSize
      }
      if (offset > 0) {
        // Copia o resto (quadro parcial) pra um buffer próprio — sem isso,
        // o subarray manteria viva na memória a região inteira já consumida.
        const rest = Buffer.from(buffer.subarray(offset))
        pendingChunks = rest.length > 0 ? [rest] : []
        pendingBytes = rest.length
      }
      if (latestFrame) {
        // Cópia exata do quadro — um `subarray` levaria pelo IPC o
        // ArrayBuffer inteiro por baixo dele, não só o trecho do quadro.
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
          // AUDITORIA: stop() + start() em sequência (trocar de monitor)
          // deixava o processo ANTIGO ainda despejando bytes no mesmo
          // buffer do processo NOVO — o cabeçalho/tamanhos dos quadros
          // se misturavam e o fluxo inteiro ficava corrompido.
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

        // stderr é só texto de diagnóstico (ver capture.cpp) — mesmo
        // esquema do process-audio-capture.exe: repassa linhas "ERROR..."
        // pro renderer, "STATUS..." só vai pro log em arquivo.
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

  // Ver o bloco grande "DÉCIMA QUARTA RODADA" perto do topo do arquivo —
  // deixa o RENDERER (VoiceContext.tsx) escrever no mesmo arquivo de log
  // que o processo principal já usa, sem depender do DevTools.
  onTrusted('debug:log', (_event, message) => {
    appendDebugLog('renderer', String(message))
  })

  // --- Push-to-talk global -----------------------------------------
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
      // AUDITORIA: segurar a tecla gera keydown REPETIDO (auto-repetição
      // do teclado, ~30 vezes por segundo) — antes cada um virava uma
      // mensagem IPC + atualização de estado no React. Agora só a
      // TRANSIÇÃO (soltou → apertou) é enviada.
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
      // Acontece principalmente no macOS sem permissão de
      // Acessibilidade concedida, ou em ambientes Linux sem X11 —
      // desiste de vez do modo global pra essa sessão do app.
      console.error('Falha ao iniciar uiohook (push-to-talk vai funcionar só com o app em foco):', err?.message)
      uiohookAvailable = false
      return false
    }
  }

  handleTrusted('ptt:is-global-available', () => tryLoadUiohook())

  handleTrusted('ptt:start-capture', () => {
    if (!ensureUiohookStarted()) return Promise.resolve(null)
    // AUDITORIA: se já existia uma captura pendente (a pessoa clicou em
    // "definir tecla" duas vezes), a Promise anterior ficava pendurada pra
    // sempre — agora ela é resolvida como "cancelada" antes da nova.
    if (pttCaptureResolver) {
      const previous = pttCaptureResolver
      pttCaptureResolver = null
      previous(null)
    }
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

  handleTrusted('ptt:set-active-key', (_event, keycode) => {
    pttGlobalKeycode = Number.isSafeInteger(keycode) ? keycode : null
    pttKeyDown = false
    if (pttGlobalKeycode !== null) ensureUiohookStarted()
  })

  // AUDITORIA: encerra TUDO que existe só por causa da página atual
  // (processos de captura, vigias, captura de tecla pendente). Antes isso
  // só acontecia ao FECHAR o app — se a página recarregasse ou o processo
  // de renderização travasse no meio de um compartilhamento, os .exe de
  // captura continuavam rodando e mandando quadros/áudio pra uma página
  // que já não sabia mais deles (CPU/GPU gastos à toa até fechar o app).
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
  // 'did-navigate' só dispara quando uma navegação da página PRINCIPAL é
  // de fato concluída (recarga incluída) — nunca pra troca de rota interna
  // do React (hash/pushState) nem pra navegações barradas em will-navigate.
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
        // já estamos fechando o app mesmo, sem problema
      }
    }
    // Para o vigia de foco do jogo.
    stopForegroundWatch()
    stopProcessAudioCapture()
    // Idem pros dois .exe de fallback de captura de tela (WGC e GDI) —
    // ver o bloco grande logo acima.
    wgcCapture.stop()
    gdiCapture.stop()
    globalShortcut.unregisterAll()
  })
  app.once('will-quit', () => {
    flushDebugLogSync()
  })
  // -------------------------------------------------------------------

  // Consulta do estado atual do auto-updater (ver lastUpdateStatus mais
  // abaixo). Registrado SEMPRE — em desenvolvimento só devolve null — pra
  // chamada do renderer nunca falhar com "no handler registered".
  let lastUpdateStatus = null
  handleTrusted('app:get-update-status', () => lastUpdateStatus)

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
    //
    // AUDITORIA — melhorias no sistema de atualização:
    //  - Checagens AUTOMÁTICAS (a cada 30min, ao voltar da suspensão)
    //    agora são SILENCIOSAS: antes, a cada 30 minutos o selo
    //    "Verificando atualizações..." → "App atualizado" piscava no
    //    canto da tela (e, sem internet, um alerta vermelho de erro).
    //    Só a checagem da abertura do app e a manual (Configurações)
    //    mostram esses estados; download e "pronta pra instalar"
    //    continuam aparecendo sempre.
    //  - Não dispara uma checagem nova enquanto outra checagem/download
    //    ainda está em andamento, nem depois que a atualização já foi
    //    baixada (antes, a checagem de 30 em 30 min podia começar outro
    //    download por cima do primeiro).
    //  - Sem internet / falha de rede: tenta de novo sozinho com espera
    //    crescente (1, 2, 5, 10 min) em vez de só daqui a 30 min.
    //  - O progresso do download só é enviado quando o PERCENTUAL muda —
    //    antes era a cada pedacinho baixado (centenas de mensagens IPC e
    //    re-renderizações do React por segundo numa conexão rápida).
    //  - O último estado relevante (baixando/pronta) fica guardado e o
    //    renderer pode pedir ele de novo (app:get-update-status) — se a
    //    página recarregar depois do download terminar, o botão
    //    "Reiniciar" não some mais.
    //  - Tudo que o electron-updater registra vai pro mamacos-debug.log.
    const UPDATE_DOWNLOAD_PAGE = 'https://github.com/Felipe-M-Soares/mamacoVoip/releases/latest'
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
    // O instalador NSIS daqui não é um "web installer" — deixar isso
    // explícito só evita um aviso a cada download no log.
    autoUpdater.disableWebInstaller = true

    function sendUpdateStatus(status, extra = {}) {
      const payload = { status, ...extra }
      // Só "baixando" e "pronta" valem a pena ser reapresentados depois
      // (ver app:get-update-status) — "verificando"/"atualizado"/"erro"
      // são avisos passageiros.
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
      // Versão instalada pela Microsoft Store: quem atualiza é a própria
      // Store (o pacote MSIX nem permite o app se sobrescrever). Sem isso
      // o electron-updater tentaria baixar o .exe do GitHub à toa.
      if (process.windowsStore) {
        if (!silent) sendToMain('update-status', { status: 'not-available' })
        return
      }
      if (updateReadyToInstall || updateDownloadInFlight) {
        // Já tem algo em andamento/pronto — num pedido manual, só
        // reapresenta o estado atual em vez de começar tudo de novo.
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
          // sem conexão ou nenhum release publicado ainda — o evento
          // 'error' abaixo já trata/avisa, aqui só não deixa a Promise
          // rejeitada solta.
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
      sendUpdateStatus('downloading', { version: availableVersion })
    })
    autoUpdater.on('update-not-available', () => {
      networkRetryCount = 0
      if (!updateCheckSilent) sendUpdateStatus('up-to-date')
    })
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.floor(progress?.percent ?? 0)))
      if (percent === lastSentPercent) return
      lastSentPercent = percent
      sendUpdateStatus('downloading', { percent, version: availableVersion })
    })
    autoUpdater.on('update-downloaded', (info) => {
      updateDownloadInFlight = false
      updateReadyToInstall = true
      clearUpdateRetryTimer()
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
    // Antes eram 6 tentativas de 25s (até 2min30 de espera, com a pessoa
    // vendo "Verificando atualizações..." travado na tela o tempo todo) —
    // um exagero pra um atraso de indexação do GitHub que, na prática, é
    // de segundos, não minutos. Reduzido bem: só 2 tentativas rápidas.
    const MAX_UPDATE_RETRIES = 2
    const UPDATE_RETRY_DELAY_MS = 4_000
    const NETWORK_ERROR_PATTERN =
      /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED|ABORTED|FAILED)|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY_CONNECTION_FAILED|ERR_NETWORK_IO_SUSPENDED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up|net::ERR_/i

    autoUpdater.on('error', (err) => {
      const wasDownloading = updateDownloadInFlight
      updateDownloadInFlight = false

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
      appendDebugLog('updater:error-event', raw.slice(0, 2000))

      // Um release recém-publicado pode demorar alguns segundos pra o
      // GitHub "enxergar" ele como o mais recente (atraso normal de
      // indexação do próprio GitHub, não é bug daqui) — isso costuma
      // aparecer como 404 bem na primeira checagem depois de abrir o
      // app. Em vez de desistir na hora, tenta de novo com uma pausa
      // curta antes de qualquer coisa — mas só duas vezes, rápido, pra
      // não deixar a pessoa esperando minutos vendo "verificando".
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

      // Um 404 especificamente do "latest.yml" (o arquivo de manifesto
      // que o electron-updater procura) depois de esgotar as tentativas
      // quer dizer, na prática, que ainda não existe NENHUM release
      // publicado com esse arquivo — ou seja, não tem atualização
      // nenhuma disponível, o que do ponto de vista de quem está usando
      // o app é exatamente a mesma coisa que "já está tudo atualizado".
      // Mostrar isso como um erro assustador (ícone vermelho, stack de
      // erro) é enganoso; mostra o mesmo aviso tranquilo de "App
      // atualizado" que aparece quando não tem nada novo mesmo.
      if (/latest\.yml|Cannot find channel/i.test(raw)) {
        if (!updateCheckSilent) sendUpdateStatus('up-to-date')
        return
      }

      // Falha de REDE (sem internet, Wi-Fi caiu no meio do download,
      // DNS, proxy...): tenta de novo sozinho, com espera crescente.
      if (NETWORK_ERROR_PATTERN.test(raw)) {
        const delay = NETWORK_RETRY_DELAYS_MS[Math.min(networkRetryCount, NETWORK_RETRY_DELAYS_MS.length - 1)]
        networkRetryCount++
        scheduleUpdateRetry(delay)
        // Só incomoda a pessoa se ELA pediu a checagem (abertura/manual)
        // ou se um download que ela estava VENDO acontecer foi interrompido
        // (senão o selo "Baixando..." ficaria travado na tela).
        if (!updateCheckSilent || wasDownloading) {
          sendUpdateStatus('error', {
            message: `Sem conexão com o servidor de atualizações. Vou tentar de novo sozinho em ${Math.round(delay / 60_000)} min.`,
            downloadUrl: UPDATE_DOWNLOAD_PAGE,
          })
        }
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
          downloadUrl: UPDATE_DOWNLOAD_PAGE,
        })
        return
      }

      // Erro genérico numa checagem automática silenciosa (e sem download
      // visível em andamento): já foi pro log acima, não precisa de alerta.
      if (updateCheckSilent && !wasDownloading) return

      sendUpdateStatus('error', { message: raw.slice(0, 400), downloadUrl: UPDATE_DOWNLOAD_PAGE })
    })

    // Sem os dois `true`, o electron-updater roda o instalador no modo
    // NORMAL (não silencioso) por padrão — é exatamente por isso que
    // clicar em "Reiniciar" abria a telinha de instalação de novo, como
    // se fosse a primeira vez, em vez de só trocar a versão e voltar
    // direto pro app. `true, true` = instala em silêncio (sem nenhuma
    // janela aparecer) e reabre o app sozinho assim que terminar — junto
    // com "oneClick: true" no nsis (package.json), fica igual a apps de chat populares
    // de verdade: a pessoa nem percebe que uma instalação aconteceu.
    //
    // AUDITORIA: só aceita o pedido se já existe uma atualização baixada
    // (antes, chamar isso sem nada baixado lançava exceção no processo
    // principal) e marca isQuitting ANTES — sem isso, dependendo da ordem
    // dos eventos, o 'close' da janela principal (que só esconde na
    // bandeja) podia segurar o fechamento e a instalação não acontecia.
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
      setTimeout(() => runUpdateCheck({ silent: false }), 1500)

      // Checar só quando o app abre não é suficiente — muita gente
      // deixa o app aberto o dia inteiro, e nesse caso uma atualização
      // publicada nesse meio tempo só seria vista no próximo reinício
      // (que podia demorar dias). Rechecando a cada 30 minutos, uma
      // atualização nova chega bem mais rápido pra quem já está com o
      // app aberto, sem precisar fechar e abrir de novo.
      updateIntervalTimer = setInterval(() => runUpdateCheck({ silent: true }), UPDATE_CHECK_INTERVAL_MS)
    })

    // Voltando da suspensão/hibernação (PC "dormiu" a noite inteira): o
    // intervalo de 30 min acima fica congelado enquanto o PC dorme —
    // checa logo depois de acordar (com uma folga pra rede voltar), se a
    // última checagem já tem mais de 10 minutos.
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

  // AUDITORIA: no macOS, clicar no ícone do Dock com a janela fechada
  // criava uma janela nova com `show: false` que NUNCA aparecia (o
  // 'ready-to-show' que a mostra só foi ligado na janela original).
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

// Segunda camada de defesa contra novas janelas fora de controle —
// mesmo que algo escape do setWindowOpenHandler, qualquer BrowserWindow
// criada nasce com as mesmas restrições de segurança do app inteiro.
// AUDITORIA: antes isso só bloqueava <webview>. Agora TODO webContents
// criado (splash, sobreposição, e qualquer outro que venha a existir)
// também nasce com: navegação pra fora do app barrada, e window.open
// negado por padrão (a janela principal troca esse padrão pelo dela, que
// abre links externos no navegador — ver createWindow).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    // A janela principal tem o próprio handler (que também abre o link
    // no navegador); aqui só garante que NENHUM outro webContents saia
    // da página em que nasceu.
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
    // Se uma atualização já terminou de baixar em segundo plano, instala
    // e reabre o app automaticamente ao fechar — a pessoa não precisa
    // clicar em "Reiniciar", só fechar e abrir o app normalmente já
    // basta pra receber a versão nova.
    if (updateReadyToInstall) {
      // Mesmo motivo do outro quitAndInstall acima: sem os `true, true`,
      // isso abriria a tela de instalação visível bem na hora de fechar o
      // app, em vez de trocar a versão em silêncio e já reabrir sozinho.
      isQuitting = true
      autoUpdater.quitAndInstall(true, true)
    } else {
      app.quit()
    }
  }
})
