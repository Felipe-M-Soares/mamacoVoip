const { app, BrowserWindow, session, Menu, Tray, nativeImage, Notification, shell, ipcMain, dialog, protocol, net, desktopCapturer, globalShortcut, screen } = require('electron')
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
// pra essa segunda tentativa. É assim que apps como o Discord conseguem
// "puxar" a janela já aberta em vez de duplicar.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  return
}

// VIGÉSIMA SEGUNDA RODADA — relatado com razão: "mas o OBS e o Discord
// capturam esses jogos tranquilamente". Isso é verdade, e joga por
// terra a explicação de que tela cheia exclusiva com anti-cheat SEMPRE
// quebra a duplicação de tela — se fosse uma regra dura do Windows, o
// Display Capture do OBS (que usa a MESMA API de duplicação de tela,
// DXGI Output Duplication) também falharia sempre, e não falha. A
// diferença real está em QUEM implementa a captura: o Discord e o OBS
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
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer')

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
if (!app.isDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME)) {
  app.setAsDefaultProtocolClient(AUTH_DEEP_LINK_SCHEME)
}

let pendingAuthDeepLink = null
// Cobre o caso (2) acima: app fechado, aberto direto pelo link.
pendingAuthDeepLink =
  process.argv.find((arg) => arg.startsWith(`${AUTH_DEEP_LINK_SCHEME}://`)) ?? null

function handleAuthDeepLink(url) {
  if (!url || !url.startsWith(`${AUTH_DEEP_LINK_SCHEME}://`)) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingAuthDeepLink = url
    return
  }
  mainWindow.webContents.send('google-auth-callback', url)
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

// Rede de segurança geral: se algum erro escapar de todos os try/catch
// (de qualquer parte do app, não só do push-to-talk), isso evita que
// ele derrube o processo principal inteiro — o que travaria o app
// inteiro pra todo mundo, muito pior do que uma função específica
// falhar sozinha.
process.on('uncaughtException', (err) => {
  console.error('Erro não tratado no processo principal:', err)
  // DÉCIMA SÉTIMA RODADA: além do console (que ninguém vê num app
  // empacotado — foi exatamente esse o motivo de existir o log em
  // arquivo abaixo, appendDebugLog), grava aqui também. `appendDebugLog`
  // é uma DECLARAÇÃO de função (não uma const/arrow), então já está
  // disponível aqui mesmo definida mais abaixo no arquivo — só importa
  // que os dois já existam quando um erro de verdade acontecer em
  // tempo de execução, o que sempre é depois do script inteiro já ter
  // rodado uma vez.
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
const debugLogPath = path.join(app.getPath('userData'), 'mamacos-debug.log')
function appendDebugLog(source, message) {
  try {
    require('node:fs').appendFileSync(debugLogPath, `[${new Date().toISOString()}] [${source}] ${message}\n`)
  } catch {
    // Sem essa pasta gravável, ou disco cheio — não é crítico o
    // suficiente pra incomodar quem está usando o app com isso.
  }
}

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
  // NÃO incluir 'rainbowsix_be.exe' aqui: é o serviço do BattlEye
  // (anti-cheat) do jogo, que fica residente em segundo plano — muitas
  // vezes iniciado com o Windows — mesmo depois que você fecha o jogo.
  // Era por isso que o status ficava travado em "Jogando Rainbow Six
  // Siege" pra sempre: esse processo nunca some da lista do tasklist,
  // então a detecção nunca voltava a null. O processo do jogo em si
  // ('rainbowsix.exe' / variantes _vulkan/_dx11 abaixo) é o sinal
  // confiável de que o jogo está de fato aberto.
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
// O "último app em primeiro plano" (lastForegroundApp, ver abaixo) tinha
// esse mesmo intervalo de 15s — bom o bastante pra achar QUAL jogo está
// rodando (tasklist inteiro, mais pesado), mas alto demais pra pegar o
// jogo certo quando a pessoa alterna pra ele e volta rápido pro mamaco
// pra compartilhar (ex: menos de 15s de diferença = ainda pegava o valor
// ANTIGO/vazio). Como o snapshot de foreground é uma chamada leve e
// separada (um PowerShell só, sem tasklist), roda numa frequência bem
// maior, num timer próprio.
const FOREGROUND_CHECK_INTERVAL_MS = 3_000

let mainWindow = null
let isQuitting = false
let updateReadyToInstall = false
let gameCheckTimer = null
let foregroundCheckTimer = null
// Trava simples pra nunca ter duas chamadas de getForegroundWindowInfo() (que
// abrem um PowerShell + compilam um pedacinho de C# via Add-Type CADA vez)
// rodando ao mesmo tempo. Sem isso: se uma chamada demorar mais que
// FOREGROUND_CHECK_INTERVAL_MS (bem provável com um jogo pesado tomando toda
// a CPU/GPU — é justamente PowerShell+Add-Type que fica lento nessa hora), o
// próximo tick do setInterval dispara outra chamada por cima da anterior
// ainda rodando, empilhando cada vez mais processos concorrentes e piorando
// a lentidão que causou o atraso em primeiro lugar (efeito bola de neve).
let foregroundCheckInFlight = false
let currentGame = null
// Última janela que esteve em primeiro plano ENQUANTO nossa própria janela
// não estava em foco — ver getForegroundWindowInfo/o laço em
// startGameDetection abaixo pro porquê disso existir (generaliza o atalho
// "Compartilhar seu jogo" pra QUALQUER jogo/app, não só os da lista
// KNOWN_GAMES).
let lastForegroundApp = null
// Nome(s) de processo que a gente está de olho pra saber quando a pessoa
// FECHOU o jogo/app que estava compartilhando em modo tela cheia (ver
// watchedProcessWasSeen logo abaixo e o bloco "screen-share-sources" mais
// adiante) — generalização do que antes só existia pros jogos da lista
// KNOWN_GAMES.
let watchedProcessNames = []
let watchedProcessWasSeen = false
// NONA RODADA: contador de "vezes seguidas que detectamos um jogo
// CADASTRADO pelo tasklist, mas o Windows não conseguiu achar NENHUMA
// janela de verdade pra ele" — ver a verificação extra dentro de
// startGameDetection logo abaixo. Existe pra não "piscar" o status
// (mostrar "Jogando" e sumir de novo) por causa de uma falha isolada e
// passageira do PowerShell.
let gameWindowMissStreak = 0
let gameCheckTickCount = 0

// Pega a lista de processos rodando UMA vez por verificação (a cada
// GAME_CHECK_INTERVAL_MS) e reaproveita esse resultado tanto pra detectar
// jogo conhecido (KNOWN_GAMES) quanto pra checar se um processo que
// estamos vigiando (watchedProcessNames) ainda está rodando — evitar dois
// `tasklist`/`ps` separados a cada tick.
function getRunningProcessListLower() {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'win32' ? 'tasklist' : process.platform === 'darwin' ? 'ps -Ao comm' : 'ps -eo comm'

    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(err || !stdout ? '' : stdout.toLowerCase())
    })
  })
}

function detectRunningGameFromList(lower) {
  if (!lower) return null
  for (const [processName, label] of Object.entries(KNOWN_GAMES)) {
    if (lower.includes(processName)) return label
  }
  return null
}

function startGameDetection() {
  if (gameCheckTimer) return
  gameCheckTimer = setInterval(async () => {
    gameCheckTickCount++
    const lower = await getRunningProcessListLower()

    let game = detectRunningGameFromList(lower)

    // NONA RODADA — corrige o status "Jogando X" ficando travado mesmo
    // depois de fechar o jogo de verdade. `tasklist` sozinho só prova que
    // EXISTE um processo com aquele nome — não que o jogo está de fato
    // aberto e jogável. Jogos com anti-cheat (BattlEye/EasyAntiCheat, ex.:
    // Rainbow Six Siege) são conhecidos por às vezes deixar o processo
    // principal PENDURADO em segundo plano, sem janela nenhuma, mesmo
    // depois da pessoa fechar o jogo — o `tasklist` nunca reflete isso,
    // então o status ficava "Jogando" pra sempre.
    //
    // A correção: quando um jogo CADASTRADO é detectado, confirma com o
    // Windows que existe uma JANELA de verdade pra esse processo
    // (reaproveita getGameWindowInfo, a mesma varredura usada pro atalho
    // de compartilhar — já lida bem com jogos borderless/minimizados, não
    // depende de título). Só roda essa verificação extra (mais pesada,
    // compila C# via Add-Type) na hora que o status MUDA (pra não mostrar
    // "Jogando" nem por um instante se já nasce sem janela — caso clássico
    // do processo zumbi) e, enquanto continuar "jogando", só de novo a
    // cada ~1 minuto (a cada 4 verificações de 15s) — não a cada tick, pra
    // não pesar à toa enquanto o jogo de verdade está rodando normal.
    // Uma falha ISOLADA nessas re-checagens periódicas não derruba o
    // status na hora (só na segunda falha SEGUIDA) — evita "piscar" por
    // causa de um PowerShell lento/travado só daquela vez.
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
      mainWindow?.webContents.send('game-status-changed', game)
    }

    // Se tem um processo sendo vigiado (compartilhamento de tela cheia
    // ativo) e ele SUMIU da lista depois de já termos confirmado que
    // estava rodando, avisa o renderer pra encerrar o compartilhamento
    // sozinho — ver screenShareGameHint.ts e VoiceContext.tsx.
    if (watchedProcessNames.length > 0) {
      const stillRunning = Boolean(lower) && watchedProcessNames.some((name) => lower.includes(name))
      if (stillRunning) {
        watchedProcessWasSeen = true
      } else if (watchedProcessWasSeen) {
        watchedProcessNames = []
        watchedProcessWasSeen = false
        mainWindow?.webContents.send('watched-process-exited')
      }
    }

  }, GAME_CHECK_INTERVAL_MS)

  if (foregroundCheckTimer) return
  foregroundCheckTimer = setInterval(async () => {
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
        // SÉTIMA RODADA — corrida de dados real, achada revendo com calma:
        // o `!mainWindow.isFocused()` acima só é checado ANTES de chamar
        // getForegroundWindowInfo(), que é ASSÍNCRONO e pode levar vários
        // segundos (abre um PowerShell + compila C# na hora — daí o
        // timeout de até 4.5s). Se a pessoa alternar PRA o mamaco bem
        // nesse meio-tempo (exatamente o que acontece ao clicar em
        // "Compartilhar tela" logo depois de sair do jogo), o resultado só
        // chega DEPOIS que o mamaco já está em primeiro plano — e aí
        // `lastForegroundApp` era sobrescrito com a janela do PRÓPRIO
        // mamaco, bem na hora de abrir o seletor. Foi exatamente isso que
        // explicou a sugestão aparecer como "Mamacos Voip" em vez do jogo.
        // Rechecando o foco AGORA, depois do await, descarta esse
        // resultado quando ele já está velho/contaminado, em vez de usá-lo.
        // Segunda camada de proteção, independente da checagem de foco
        // acima: `fg.pid` nunca pode ser o PID do PRÓPRIO mamaco
        // (process.pid aqui é o processo principal do Electron, dono de
        // toda janela nativa do app — inclusive a overlay). Rejeita isso
        // incondicionalmente, mesmo que a checagem de foco por algum
        // motivo não pegue (ex.: alguma janela secundária nossa ganhando
        // foco sem mainWindow.isFocused() perceber).
        if (fg && fg.pid !== process.pid && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          lastForegroundApp = fg
        }
      } finally {
        foregroundCheckInFlight = false
      }
    }
  }, FOREGROUND_CHECK_INTERVAL_MS)
}

// ============================================================
// "Vigia de foco do jogo" — pra evitar que compartilhar TELA CHEIA
// (o fallback usado quando um jogo não aparece como janela separada,
// ver 'screen-share-sources' mais abaixo e ScreenSharePicker.tsx) vaze
// o que está na tela quando a pessoa alterna pra outro programa
// (navegador, DMs, etc.) sem parar a transmissão.
//
// A ideia: enquanto uma dessas transmissões de tela cheia "sobre um
// jogo" está ativa, fica de olho em qual é a janela em PRIMEIRO PLANO
// (não só "o processo está rodando", que é o que detectRunningGameFromList()
// já verifica) — assim que deixar de ser o próprio jogo, avisa o
// renderer, que troca o vídeo enviado pelos outros por uma tela de
// aviso (ver VoiceContext.tsx) até o jogo voltar a ser a janela ativa.
//
// Só existe no Windows (via user32.dll GetForegroundWindow, chamado de
// dentro de um PowerShell) — não tem equivalente simples/portável em
// Mac/Linux, então nesses sistemas essa proteção extra simplesmente não
// liga (a transmissão de tela cheia continua funcionando normal, só
// sem esse aviso automático).
//
// Um ÚNICO processo PowerShell fica vivo rodando um laço interno (em
// vez de abrir um processo novo a cada verificação) — herdando o
// custo de iniciar o PowerShell e compilar o pedacinho de C# (via
// Add-Type) só UMA vez, não a cada poucos segundos.
let foregroundWatcherProc = null
let foregroundWatcherGames = []

function processNamesForGameLabel(label) {
  return Object.entries(KNOWN_GAMES)
    .filter(([, gameLabel]) => gameLabel === label)
    .map(([processName]) => processName.replace(/\.exe$/i, ''))
}

// ============================================================
// "Compartilhar seu jogo" (fallback de tela cheia): antes disso, quando
// o jogo não aparecia como uma JANELA separada pro desktopCapturer (caso
// clássico de jogo em modo tela cheia exclusiva), o atalho simplesmente
// chutava a tela PRINCIPAL — o que está errado pra qualquer pessoa que
// joga com o jogo no monitor SECUNDÁRIO (setup comum: jogo numa tela,
// chat/Discord/navegador na outra). Essa função pergunta pro Windows,
// de verdade, em qual monitor a JANELA do próprio processo do jogo está
// (e qual é o TÍTULO exato dessa janela) — mesmo que a janela esteja em
// modo tela cheia exclusiva, ela quase sempre ainda tem um
// "MainWindowHandle" válido por baixo (é assim que a maioria dos jogos
// DirectX/OpenGL implementa tela cheia, por cima de uma janela normal já
// existente) — daí só usa a própria API do .NET (Screen.FromHandle, que
// já embute toda a conta de "qual monitor" sem precisar declarar
// chamada nenhuma ao Win32 na mão) pra pegar os limites (bounds) desse
// monitor, e MainWindowTitle pra pegar o nome exato da janela — esse
// título é usado em dois lugares (ver setDisplayMediaRequestHandler
// abaixo e ScreenSharePicker.tsx): (1) quando o jogo TEM uma janela
// capturável na lista do desktopCapturer, casar pelo título EXATO em
// vez de um chute por nome parecido é bem mais confiável; (2) quando
// não tem (tela cheia exclusiva), os `bounds` dizem qual monitor
// oferecer no fallback.
//
// ============================================================
// DÉCIMA TERCEIRA RODADA — o motivo real de "o Rainbow Six nunca aparece
// como sugestão mesmo com tudo mais certo" (KNOWN_GAMES tem
// 'rainbowsix.exe', o PID resolve certinho pelo tasklist, o processo
// existe): getGameWindowInfo/getForegroundWindowInfo, do jeito que
// existiam antes, abriam um powershell.exe NOVO e recompilavam o mesmo
// pedacinho de C# via Add-Type DO ZERO (o compilador csc.exe sendo
// chamado por baixo) a CADA chamada — isso NUNCA foi "alguns
// milissegundos", é bem mais pesado que isso, e com um jogo pesado
// (exatamente o caso do Rainbow Six Siege) consumindo CPU/GPU ao mesmo
// tempo, esse custo cresce ainda mais e passa fácil do timeout de 4.5s.
// O problema não parava na checagem individual falhar: em
// startGameDetection, a PRIMEIRA falha logo depois de detectar um jogo
// (justChanged) zerava `currentGame` NA HORA — então bastava UMA
// verificação lenta (bem provável logo que o jogo abre/carrega, quando
// tem pico de CPU) pra sugestão "Jogo" nunca se estabilizar, mesmo com
// o jogo rodando normal o resto do tempo. E o vigia de foreground (a
// cada 3s) tinha o mesmo custo por chamada, competindo por CPU com o
// próprio jogo o tempo todo.
//
// A correção: um ÚNICO processo PowerShell "scanner" fica vivo (mesma
// ideia já usada em startForegroundWatch/foregroundWatcherProc acima,
// generalizada agora pra também servir essas duas funções) — o Add-Type
// roda UMA vez só, na primeira vez que o scanner é preciso, e cada
// checagem seguinte é só mandar um comando de uma linha pelo stdin e
// ler uma linha de resposta (JSON) pelo stdout: sem processo novo, sem
// recompilar nada. Isso reduz o custo de cada checagem de "1-4+
// segundos, bem variável" pra tipicamente bem menos de um segundo, de
// forma CONSISTENTE — não dependente de quanto o resto do sistema (o
// próprio jogo incluso) está ocupado no instante exato.
let scannerProc = null
let scannerReadyPromise = null
let scannerQueue = []
let scannerBuffer = ''

const SCANNER_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MamacosScan {
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public struct POINT { public int X; public int Y; }
  public struct WINDOWPLACEMENT {
    public int length; public int flags; public int showCmd;
    public POINT ptMinPosition; public POINT ptMaxPosition;
    public RECT rcNormalPosition;
  }
}
"@

function Find-MamacosGameWindow($names) {
  $targetPids = @{}
  foreach ($name in $names) {
    if ($name -eq '') { continue }
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $targetPids[[int]$_.Id] = $true }
  }
  $bestHwnd = [IntPtr]::Zero
  $bestArea = 0
  $bestTitle = ''
  $bestPid = 0
  $hwnd = [MamacosScan]::GetTopWindow([IntPtr]::Zero)
  while ($hwnd -ne [IntPtr]::Zero) {
    if ($targetPids.Count -gt 0 -and [MamacosScan]::IsWindowVisible($hwnd)) {
      if ([MamacosScan]::GetAncestor($hwnd, 2) -eq $hwnd) {
        $procId = 0
        [MamacosScan]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
        if ($targetPids.ContainsKey([int]$procId)) {
          $wp = New-Object 'MamacosScan+WINDOWPLACEMENT'
          $wp.length = 44
          [MamacosScan]::GetWindowPlacement($hwnd, [ref]$wp) | Out-Null
          $rect = $wp.rcNormalPosition
          $w = $rect.Right - $rect.Left
          $h = $rect.Bottom - $rect.Top
          if ($w -ge 200 -and $h -ge 200) {
            $area = $w * $h
            if ($area -gt $bestArea) {
              $bestArea = $area
              $bestHwnd = $hwnd
              $bestPid = $procId
              $sb = New-Object System.Text.StringBuilder 512
              [MamacosScan]::GetWindowText($hwnd, $sb, 512) | Out-Null
              $bestTitle = $sb.ToString()
            }
          }
        }
      }
    }
    $hwnd = [MamacosScan]::GetWindow($hwnd, 2)
  }
  if ($bestHwnd -ne [IntPtr]::Zero) {
    $s = [System.Windows.Forms.Screen]::FromHandle($bestHwnd)
    $b = $s.Bounds
    # DÉCIMA OITAVA RODADA: inclui o HWND agora (antes só bounds/title/pid)
    # — é o que permite mandar "restaurar essa janela" (comando R| abaixo)
    # quando ela está MINIMIZADA: GetWindowPlacement acima devolve os
    # bounds "de quando estava restaurada" (rcNormalPosition) mesmo com o
    # jogo minimizado agora, então esse achado continua valendo mesmo
    # nesse estado — só faltava o HWND pra dar pra agir sobre ele.
    return [PSCustomObject]@{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height; title = $bestTitle; pid = $bestPid; hwnd = $bestHwnd.ToInt64() }
  }
  return $null
}

# DÉCIMA OITAVA RODADA: "compartilhamento de tela não reconhece tela
# minimizada" — não é bug nosso, é o próprio Chromium (a base do
# Electron) que EXCLUI janelas minimizadas da lista de fontes
# capturáveis (desktopCapturer.getSources() em main.cjs), então elas
# nunca aparecem no seletor pra escolher, ponto. Isso é assim pra
# QUALQUER programa de captura no Windows, não só o nosso. O que dá pra
# fazer de verdade: se a gente já sabe (via Find-MamacosGameWindow acima)
# que o jogo detectado está minimizado, oferece um botão "Restaurar e
# compartilhar" que chama isso aqui pra trazer a janela de volta ANTES
# de buscar a lista de fontes de novo — depois de restaurada, ela some
# do estado minimizado e passa a aparecer normalmente.
function Restore-MamacosWindow($hwndStr) {
  $ptr = [IntPtr][int64]$hwndStr
  if (-not [MamacosScan]::IsWindow($ptr)) {
    return [PSCustomObject]@{ ok = $false }
  }
  # SW_RESTORE = 9. Assíncrono (ShowWindowAsync) de propósito — ShowWindow
  # comum pode travar esperando o processo dono da janela responder à
  # mensagem, e um jogo pesado/travado momentaneamente não pode travar
  # nosso scanner junto.
  [MamacosScan]::ShowWindowAsync($ptr, 9) | Out-Null
  [MamacosScan]::SetForegroundWindow($ptr) | Out-Null
  return [PSCustomObject]@{ ok = $true }
}

function Find-MamacosForegroundWindow {
  $hwnd = [MamacosScan]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return $null }
  $procId = 0
  [MamacosScan]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
  try {
    $proc = Get-Process -Id $procId -ErrorAction Stop
  } catch {
    return $null
  }
  $s = [System.Windows.Forms.Screen]::FromHandle($hwnd)
  $b = $s.Bounds
  $sb = New-Object System.Text.StringBuilder 512
  [MamacosScan]::GetWindowText($hwnd, $sb, 512) | Out-Null
  return [PSCustomObject]@{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height; title = $sb.ToString(); processName = $proc.ProcessName; pid = $procId }
}

function Find-MamacosPidsForHandles($hwnds) {
  $out = @()
  foreach ($h in $hwnds) {
    if ($h -eq '') { continue }
    $ptr = [IntPtr][int64]$h
    # IsWindow confirma que o handle ainda é válido AGORA — sem essa
    # checagem, um número reaproveitado por outra janela (handles do
    # Windows podem ser reciclados) poderia devolver um PID de um
    # processo completamente diferente do esperado.
    if ([MamacosScan]::IsWindow($ptr)) {
      $procId = 0
      [MamacosScan]::GetWindowThreadProcessId($ptr, [ref]$procId) | Out-Null
      $out += [PSCustomObject]@{ hwnd = $h; pid = $procId }
    } else {
      $out += [PSCustomObject]@{ hwnd = $h; pid = 0 }
    }
  }
  return ,$out
}

function Find-MamacosTitlePidMap {
  $out = @()
  Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object {
    $out += [PSCustomObject]@{ title = $_.MainWindowTitle; pid = $_.Id }
  }
  return ,$out
}

Write-Output 'READY'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $result = $null
  try {
    if ($line.StartsWith('G|')) {
      $rest = $line.Substring(2)
      $names = @()
      if ($rest -ne '') { $names = $rest.Split(',') }
      $result = Find-MamacosGameWindow $names
    } elseif ($line -eq 'F') {
      $result = Find-MamacosForegroundWindow
    } elseif ($line.StartsWith('P|')) {
      $rest = $line.Substring(2)
      $hwnds = @()
      if ($rest -ne '') { $hwnds = $rest.Split(',') }
      $result = Find-MamacosPidsForHandles $hwnds
    } elseif ($line -eq 'T') {
      $result = Find-MamacosTitlePidMap
    } elseif ($line.StartsWith('R|')) {
      $result = Restore-MamacosWindow ($line.Substring(2))
    }
  } catch {
    $result = $null
  }
  if ($result -eq $null) {
    Write-Output 'null'
  } else {
    # -InputObject (em vez de PIPAR $result pro ConvertTo-Json) importa
    # de verdade pros comandos P|/T acima: um ARRAY com 0 ou 1 item, se
    # PIPADO, o PowerShell "desembrulha" item por item antes do
    # ConvertTo-Json ver a coleção inteira — o resultado vira um objeto
    # solto (ou nada, se vazio) em vez de um array JSON de verdade, e o
    # JSON.parse(...) do lado do Node quebraria/interpretaria errado.
    # Passando por -InputObject, o array inteiro chega de uma vez e o
    # formato ([] / [x] / [x,y]) fica sempre correto, com 0, 1 ou mais
    # itens.
    Write-Output (ConvertTo-Json -InputObject $result -Compress)
  }
}
`

// Mata o scanner e libera (com null) qualquer pergunta que ainda estava
// esperando resposta — melhor devolver "não sei" na hora do que deixar
// a fila esperando pra sempre por uma resposta que nunca vai chegar.
function killScanner() {
  const queued = scannerQueue
  scannerQueue = []
  for (const pending of queued) {
    clearTimeout(pending.timer)
    pending.resolve(null)
  }
  if (scannerProc) {
    try {
      scannerProc.kill()
    } catch {
      // já pode ter morrido sozinho
    }
  }
  scannerProc = null
  scannerReadyPromise = null
  scannerBuffer = ''
}

// Garante que existe um scanner vivo e devolve uma Promise que resolve
// com o processo assim que ele sinalizar 'READY' (Add-Type já
// compilado) — ou com null se não der pra usar (fora do Windows,
// PowerShell bloqueado, etc.). Reaproveita a MESMA Promise/processo
// entre chamadas concorrentes — sem isso, duas checagens pedidas quase
// ao mesmo tempo (ex.: o vigia de foreground e o de jogo caindo juntos)
// tentariam abrir um scanner CADA UMA.
function ensureScanner() {
  if (process.platform !== 'win32') return Promise.resolve(null)
  if (scannerProc && scannerReadyPromise) return scannerReadyPromise

  let proc
  try {
    const encoded = Buffer.from(SCANNER_SCRIPT, 'utf16le').toString('base64')
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true }
    )
  } catch {
    return Promise.resolve(null)
  }
  scannerProc = proc
  scannerBuffer = ''
  scannerQueue = []

  scannerReadyPromise = new Promise((resolve) => {
    let settled = false
    const settleOnce = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    proc.stdout?.on('data', (chunk) => {
      scannerBuffer += chunk.toString()
      let idx
      while ((idx = scannerBuffer.indexOf('\n')) >= 0) {
        const line = scannerBuffer.slice(0, idx).trim()
        scannerBuffer = scannerBuffer.slice(idx + 1)
        if (line === 'READY') {
          settleOnce(proc)
          continue
        }
        const pending = scannerQueue.shift()
        if (!pending) continue
        clearTimeout(pending.timer)
        if (line === 'null' || line === '') {
          pending.resolve(null)
          continue
        }
        try {
          pending.resolve(JSON.parse(line))
        } catch {
          pending.resolve(null)
        }
      }
    })
    proc.on('error', () => {
      settleOnce(null)
      killScanner()
    })
    proc.on('exit', () => {
      settleOnce(null)
      killScanner()
    })
    // Segurança: se o 'READY' nunca chegar (Add-Type falhando por algum
    // motivo raro do ambiente/política do sistema), não trava pra
    // sempre — só desiste e volta a se comportar como antes (best-effort).
    setTimeout(() => settleOnce(null), 8000)
  })

  return scannerReadyPromise
}

// Manda um comando de uma linha pro scanner e devolve a resposta já
// decodificada (ou null em qualquer falha — processo indisponível,
// timeout individual, JSON inválido). Timeout por consulta bem mais
// generoso que o antigo (que incluía o custo de Add-Type) porque agora
// só cobre o Win32 scan em si — se mesmo assim estourar, tratamos como
// sinal de que o processo travou de verdade e reiniciamos ele pra
// próxima vez, em vez de deixar a fila fora de sincronia.
function scannerQuery(command) {
  return ensureScanner().then((proc) => {
    if (!proc || proc.killed || !proc.stdin || !proc.stdin.writable) return null
    return new Promise((resolve) => {
      const pending = {
        resolve,
        timer: setTimeout(() => {
          const idx = scannerQueue.indexOf(pending)
          if (idx >= 0) scannerQueue.splice(idx, 1)
          resolve(null)
          killScanner()
        }, 6000),
      }
      scannerQueue.push(pending)
      try {
        proc.stdin.write(command + '\n')
      } catch {
        const idx = scannerQueue.indexOf(pending)
        if (idx >= 0) scannerQueue.splice(idx, 1)
        clearTimeout(pending.timer)
        resolve(null)
      }
    })
  })
}

// Só Windows, best-effort — se o PowerShell não estiver disponível, ou
// nenhum processo do jogo tiver janela (raro, mas possível logo no
// instante de abrir o jogo), simplesmente devolve null e quem chama cai
// de volta nos chutes de antes (nome parecido / tela principal).
//
// A varredura em si (comentários abaixo) é a mesma de sempre — só a
// FORMA de rodar ela mudou (via scannerQuery, ver bloco grande acima em
// vez de abrir+compilar um PowerShell novo aqui).
function getGameWindowInfo(processNames) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }
    if (!processNames || processNames.length === 0) {
      resolve(null)
      return
    }
    scannerQuery(`G|${processNames.map((n) => String(n).replace(/[,|\r\n]/g, '')).join(',')}`).then((r) => {
      if (!r || typeof r.pid !== 'number' || !(r.pid > 0)) {
        resolve(null)
        return
      }
      resolve({
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        windowTitle: typeof r.title === 'string' && r.title ? r.title : null,
        pid: r.pid,
        // DÉCIMA OITAVA RODADA: usado só pra oferecer "Restaurar e
        // compartilhar" quando esse jogo está minimizado — ver
        // screen-share:restore-window abaixo e Restore-MamacosWindow no
        // SCANNER_SCRIPT.
        hwnd: typeof r.hwnd === 'number' && r.hwnd > 0 ? r.hwnd : null,
      })
    })
  })
}

// ============================================================
// Generalização de getGameWindowInfo acima: em vez de precisar saber de
// ANTEMÃO o nome do processo (só possível pros jogos cadastrados em
// KNOWN_GAMES), pergunta pro Windows QUAL é a janela em primeiro plano
// agora e devolve os dados dela — funciona pra qualquer app/jogo, cadastrado
// ou não. É o que dá suporte ao atalho genérico "Compartilhar [sua janela
// ativa]" quando não reconhecemos o jogo pelo nome (ver startGameDetection,
// que chama isso periodicamente e guarda em lastForegroundApp — chamar na
// hora exata de abrir o seletor não funcionaria, porque nesse momento quem
// está em primeiro plano é o NOSSO próprio app, não o jogo).
//
// Só Windows, best-effort — mesmas limitações de getGameWindowInfo acima.
// Mesma troca da DÉCIMA TERCEIRA RODADA: agora via scannerQuery (processo
// PowerShell persistente) em vez de abrir+compilar um PowerShell novo
// aqui a cada chamada.
function getForegroundWindowInfo() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }
    scannerQuery('F').then((r) => {
      if (!r || typeof r.pid !== 'number' || !(r.pid > 0)) {
        resolve(null)
        return
      }
      resolve({
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        windowTitle: typeof r.title === 'string' && r.title ? r.title : null,
        processName: typeof r.processName === 'string' && r.processName ? r.processName.toLowerCase() : null,
        pid: r.pid,
      })
    })
  })
}

// ============================================================
// "Captura de áudio por processo" — pega o PID de CADA janela que
// aparece na lista do seletor de compartilhamento (não só a sugerida),
// casando pelo TÍTULO exato — é esse PID que a "Captura de áudio por
// processo" (ver process-audio-capture.exe em native/process-audio-capture/
// e startProcessAudioCapture mais abaixo) usa pra isolar o áudio de só
// aquele app, em vez do sistema inteiro (que inclui o próprio Mamacos
// Voip — ver o pedido que motivou isso todo: "nao tem como focar o
// audio somente na janela em que estou transmitindo?").
//
// Só Windows, best-effort. Feature experimental: se der errado (Get-Process
// falhar, PowerShell bloqueado por política do sistema, etc.), devolve um
// mapa vazio — quem chama simplesmente não oferece a opção de "áudio só
// deste app" pra essas janelas, sem quebrar o resto do seletor.
// DÉCIMA OITAVA RODADA: isso ABRIA um powershell.exe NOVO — sem
// Add-Type, mas ainda assim o custo normal de iniciar o interpretador do
// zero (tipicamente algumas centenas de ms, bem mais sob carga) — TODA
// VEZ que a pessoa clicava em "Compartilhar tela", e SOMADO ao
// getPidsForWindowHandles abaixo (que reconstruía Add-Type do zero a
// cada chamada, isso sim pesado) rodando em paralelo (Promise.all lá no
// handler screen-share:get-sources): junto, isso segurava a lista de
// janelas/telas na tela por 1-4+ segundos antes do seletor aparecer de
// verdade — exatamente o "demora pra mostrar as janelas" relatado.
// Reaproveita o MESMO processo PowerShell "scanner" que já fica vivo
// pra detecção de jogo/foreground (ver SCANNER_SCRIPT/ensureScanner
// acima) em vez de abrir um novo — normalmente o scanner já está de pé
// (o vigia de jogo/foreground já o mantém rodando), então isso vira só
// mandar uma linha por um processo já aberto, não iniciar+encerrar um
// novo interpretador inteiro.
function getWindowPidMap() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(new Map())
      return
    }
    scannerQuery('T').then((rows) => {
      const map = new Map()
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const title = typeof row?.title === 'string' ? row.title.trim() : ''
          const pid = Number(row?.pid)
          if (title && Number.isFinite(pid) && pid > 0) map.set(title, pid)
        }
      }
      resolve(map)
    })
  })
}

// Casar pelo TÍTULO (acima) tem um problema real: o `desktopCapturer.getSources()`
// tira uma "foto" do título de cada janela num instante, e getWindowPidMap()
// roda um PowerShell separado um pouco DEPOIS — se o jogo mostra qualquer
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

// DÉCIMA OITAVA RODADA: essa era a parte mais pesada do atraso — abria
// um powershell.exe NOVO e recompilava esse pedacinho de C# (Add-Type)
// DO ZERO a cada clique em "Compartilhar tela" (mesmo custo, mesma
// causa, já documentado em detalhe lá em cima no comentário sobre o
// scanner persistente pro Rainbow Six Siege: ~1-4+ segundos, pior ainda
// sob carga de CPU/GPU). Só que aqui isso rodava de novo a CADA
// abertura do seletor, não só durante detecção de jogo. Agora reusa o
// MamacosScan já compilado UMA vez no processo scanner persistente (que
// já tem IsWindow/GetWindowThreadProcessId — ver SCANNER_SCRIPT acima)
// via um novo comando "P|hwnd,hwnd,...", em vez de subir+recompilar um
// interpretador inteiro só pra isso.
function getPidsForWindowHandles(hwnds) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !hwnds || hwnds.length === 0) {
      resolve(new Map())
      return
    }
    scannerQuery(`P|${hwnds.map((h) => String(h)).join(',')}`).then((rows) => {
      const map = new Map()
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const h = Number(row?.hwnd)
          const pid = Number(row?.pid)
          if (Number.isFinite(h) && Number.isFinite(pid) && pid > 0) map.set(h, pid)
        }
      }
      resolve(map)
    })
  })
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

  foregroundWatcherGames = (processNames || []).map((n) => String(n).toLowerCase())
  if (foregroundWatcherGames.length === 0) return false

  // -EncodedCommand (Base64, UTF-16LE) evita qualquer problema de
  // aspas/escaping ao passar um script de várias linhas pela linha de
  // comando — é a forma recomendada pela própria Microsoft pra isso.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MamacosFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
while ($true) {
  try {
    $hwnd = [MamacosFg]::GetForegroundWindow()
    $procId = 0
    [MamacosFg]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
    $proc = Get-Process -Id $procId -ErrorAction Stop
    Write-Output $proc.ProcessName
  } catch {
    Write-Output ''
  }
  Start-Sleep -Milliseconds 700
}
`
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    foregroundWatcherProc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true }
    )
    let lineBuffer = ''
    let lastFocused = null
    foregroundWatcherProc.stdout?.on('data', (chunk) => {
      lineBuffer += chunk.toString()
      let newlineIndex
      while ((newlineIndex = lineBuffer.indexOf('\n')) >= 0) {
        const processName = lineBuffer.slice(0, newlineIndex).trim().toLowerCase()
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        const isFocused = foregroundWatcherGames.some((name) => processName === name)
        if (isFocused !== lastFocused) {
          lastFocused = isFocused
          mainWindow?.webContents.send('game-foreground-changed', isFocused)
        }
      }
    })
    foregroundWatcherProc.on('error', () => {
      // PowerShell pode não estar disponível/bloqueado por política do
      // sistema — desiste dessa proteção extra sem quebrar nada mais.
      foregroundWatcherProc = null
    })
    foregroundWatcherProc.on('exit', () => {
      foregroundWatcherProc = null
    })
    return true
  } catch {
    foregroundWatcherProc = null
    return false
  }
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

  // DÉCIMA QUARTA RODADA: Ctrl+Shift+I agora abre o DevTools mesmo no
  // build EMPACOTADO (antes só existia em desenvolvimento, via
  // openDevTools acima) — só pra diagnóstico à distância mesmo, sem essa
  // válvula de escape nenhum erro no console (ex.: por que a captura de
  // áudio por processo ou o fallback de áudio de sistema falharam) fica
  // visível pra quem está rodando o app já instalado, e todo esse tipo
  // de bug vira "só não funciona, sem pista nenhuma do motivo" pra
  // qualquer pessoa fora de quem tem acesso ao código-fonte.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })

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
// forceFocusMainWindow() já cuida de mostrar + contornar a proteção do
// Windows contra roubo de foco.
app.on('second-instance', (_event, argv) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  forceFocusMainWindow()

  // Windows/Linux entregam o link de volta do login do Google assim:
  // como o app já estava aberto, o clique no link "abre outra
  // tentativa" que cai aqui em vez de virar janela nova — o link vem
  // dentro desses argumentos de linha de comando.
  const deepLink = argv.find((arg) => arg.startsWith(`${AUTH_DEEP_LINK_SCHEME}://`))
  if (deepLink) handleAuthDeepLink(deepLink)
})

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
    // "fullscreen" precisa estar aqui pro botão de tela cheia da
    // transmissão funcionar — sem ela, o navegador nega o pedido de
    // element.requestFullscreen() em silêncio (sem erro nenhum no
    // console), e o botão simplesmente não fazia nada.
    const allowed = ['media', 'display-capture', 'notifications', 'fullscreen']
    callback(allowed.includes(permission))
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
  ipcMain.handle('screen-share:get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: true,
      })
      // Em telas múltiplas, precisamos saber qual delas é a PRINCIPAL —
      // sem isso, o atalho "Compartilhar seu jogo" (quando cai no
      // fallback de tela cheia — ver ScreenSharePicker.tsx) só pegava a
      // primeira tela que o Windows devolvesse nessa lista, que nem
      // sempre é onde o jogo está de fato rodando. Como a maioria de
      // quem joga com dois monitores usa o principal pro jogo e o
      // secundário pra navegador/chat/Discord, ir direto na principal é
      // a aposta mais segura — bem melhor do que arriscar compartilhar
      // sem querer a tela com as conversas abertas.
      let primaryDisplayId = null
      try {
        primaryDisplayId = String(screen.getPrimaryDisplay().id)
      } catch {
        // sem problema, só não vai ter como marcar qual é a principal
      }
      // Pergunta em qual monitor E qual é o título exato da JANELA DO
      // PRÓPRIO JOGO (ver getGameWindowInfo acima) — só quando tem um jogo
      // CADASTRADO (KNOWN_GAMES) detectado rodando, pra não gastar tempo/CPU
      // abrindo PowerShell à toa toda vez que alguém for compartilhar tela
      // sem estar jogando nada reconhecido.
      //
      // Quando não tem jogo cadastrado — a reclamação real que motivou essa
      // generalização: antes disso, um jogo fora da lista fixa KNOWN_GAMES
      // nunca tinha o atalho "compartilhar seu jogo" e sempre caía pra
      // "compartilhar a tela inteira" manual, o que parecia (e de fato
      // era) bem mais limitado que o Discord/OBS — cai pro fallback
      // genérico: a última janela que esteve em primeiro plano antes de a
      // pessoa clicar em "Compartilhar tela" (lastForegroundApp, mantido
      // fresco pelo laço em startGameDetection). Isso funciona pra
      // QUALQUER app/jogo, cadastrado ou não — mesmo princípio do atalho de
      // compartilhamento rápido do Discord, que também não depende de uma
      // lista fixa.
      let windowInfo = null
      let isKnownGame = false
      let suggestionLabel = null
      let watchProcessNamesForShare = []

      if (currentGame) {
        const knownNames = processNamesForGameLabel(currentGame)
        const info = await getGameWindowInfo(knownNames)
        if (info) {
          windowInfo = info
          isKnownGame = true
          suggestionLabel = currentGame
          watchProcessNamesForShare = knownNames
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
      const [hwndPidMap, titlePidMap] = await Promise.all([getPidsForWindowHandles(windowHwnds), getWindowPidMap()])

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
      // PowerShell simplesmente não deu tempo/travou), a sugestão "Jogo"
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
      // DÉCIMA OITAVA RODADA: "compartilhamento de tela não reconhece
      // tela minimizada" — desktopCapturer.getSources() (o próprio
      // Chromium) EXCLUI janelas minimizadas da lista, sempre, pra
      // qualquer programa de captura, não só o nosso (ver o aviso já
      // existente no rodapé do ScreenSharePicker.tsx). Isso detecta esse
      // caso especificamente pro jogo CADASTRADO sugerido: se
      // getGameWindowInfo achou o processo (então ele está rodando) mas
      // NENHUMA fonte do tipo "window" bate com o PID dele, é sinal forte
      // de que a janela existe mas está minimizada (ou, mais raro,
      // também não capturável por outro motivo) — nesse caso o
      // ScreenSharePicker.tsx pode oferecer "Restaurar e compartilhar"
      // em vez de simplesmente não mostrar nada pra escolher.
      const gameWindowHwnd = windowInfo?.hwnd ?? null
      const hasCapturableGameWindow =
        gameWindowPid !== null &&
        sources.some((s) => s.id.startsWith('window:') && resolvedPidBySourceId.get(s.id) === gameWindowPid)
      const looksMinimized = isKnownGame && gameWindowHwnd !== null && gameWindowPid !== null && !hasCapturableGameWindow

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
            thumbnail: s.thumbnail.toDataURL(),
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

  // DÉCIMA OITAVA RODADA: pedido do botão "Restaurar e compartilhar" (ver
  // looksMinimized/hwnd acima e ScreenSharePicker.tsx) — manda restaurar
  // a janela via o scanner persistente (comando R|, ver
  // Restore-MamacosWindow no SCANNER_SCRIPT) e espera um instante antes
  // de devolver, pra dar tempo do Windows recompositar a janela de
  // verdade (senão o próximo screen-share:get-sources rodaria rápido
  // demais e ainda pegaria ela como minimizada). Best-effort: `ok: false`
  // só significa "segue mostrando o aviso de sempre", nunca quebra nada.
  ipcMain.handle('screen-share:restore-window', async (_event, hwnd) => {
    if (process.platform !== 'win32' || !Number.isFinite(hwnd) || hwnd <= 0) return { ok: false }
    const result = await scannerQuery(`R|${Math.trunc(hwnd)}`)
    await new Promise((resolve) => setTimeout(resolve, 350))
    return { ok: Boolean(result?.ok) }
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
  ipcMain.handle('screen-share:select', (_event, sourceId) => {
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
  // É exatamente esse portal nativo que o Discord (e qualquer app sério
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
      if (!fallbackPinnedSourceId) {
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

  ipcMain.handle('screen-share:pin-fallback-source', (_event, sourceId) => {
    fallbackPinnedSourceId = sourceId || null
  })
  } // fim do `if (process.platform !== 'linux')` — ver DÉCIMA PRIMEIRA RODADA acima

  // Segunda chamada de reforço: o renderer chama isso de novo assim que
  // o MediaStream do compartilhamento realmente começa a fluir (pode
  // acontecer um pouco depois do resolve() acima) — cobre o caso do
  // Windows focar a janela de novo nesse meio-tempo.
  ipcMain.on('app:focus-window', () => {
    scheduleFocusReclaim()
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

  // DÉCIMA QUARTA RODADA: além do before-input-event na janela principal
  // Além do atalho de teclado normal (Ctrl+Shift+I, só dentro da janela
  // do app — ver before-input-event mais acima, que só dispara se ELA
  // estiver com foco), registra Ctrl+Shift+I também como atalho GLOBAL —
  // funciona mesmo com outra janela em foco (relatado: "não tem como
  // usar teclas de atalho do console", possivelmente porque o jogo ainda
  // estava em foco na hora de tentar). O item equivalente no menu da
  // bandeja foi removido a pedido (ver createTray acima) — esse atalho
  // de teclado continua sendo o caminho pra abrir o DevTools quando
  // precisar diagnosticar algo.
  const devToolsRegistered = globalShortcut.register('Control+Shift+I', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.toggleDevTools()
  })
  if (!devToolsRegistered) {
    console.error('Não foi possível registrar o atalho do DevTools (Ctrl+Shift+I) — pode já estar em uso por outro programa; use o menu da bandeja como alternativa.')
  }

  startGameDetection()

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getCurrentGame', () => currentGame)

  // Ver o bloco grande "Vigia de foco do jogo" (perto de
  // startGameDetection) pra entender o que isso faz e por quê. Recebe os
  // nomes de processo diretamente agora (não mais um label do
  // KNOWN_GAMES) — ver startForegroundWatch.
  ipcMain.handle('game-foreground-watch:start', (_event, processNames) => startForegroundWatch(processNames))
  ipcMain.handle('game-foreground-watch:stop', () => {
    stopForegroundWatch()
  })

  // Auto-parar o compartilhamento de TELA CHEIA quando o jogo/app
  // compartilhado é FECHADO de vez (não só perde o foco — isso quem cuida
  // é o vigia acima) — ver watchedProcessNames/watchedProcessWasSeen no
  // laço de startGameDetection, e VoiceContext.tsx (toggleScreenShare)
  // pra como o renderer usa isso.
  ipcMain.handle('game-share:watch-process-exit', (_event, processNames) => {
    watchedProcessNames = Array.isArray(processNames) ? processNames.map((n) => String(n).toLowerCase()) : []
    watchedProcessWasSeen = false
  })
  ipcMain.handle('game-share:stop-watch-process-exit', () => {
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
    mainWindow?.webContents.send('process-audio:chunk', merged)
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

  function startProcessAudioCapture(pid) {
    stopProcessAudioCapture()
    appendDebugLog('main', `startProcessAudioCapture: pedido pra pid=${pid}`)
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Captura de áudio por processo só existe no Windows.' }
    }
    if (!pid || !Number.isFinite(pid) || pid <= 0) {
      appendDebugLog('main', `startProcessAudioCapture: pid inválido (${pid})`)
      return { ok: false, error: 'PID inválido.' }
    }
    const exePath = resolveProcessAudioCaptureExePath()
    if (!require('node:fs').existsSync(exePath)) {
      appendDebugLog('main', `startProcessAudioCapture: exe não encontrado em ${exePath}`)
      return {
        ok: false,
        error:
          'process-audio-capture.exe não encontrado nesta instalação (build sem esse componente, ou ainda não compilado pro seu sistema).',
      }
    }
    try {
      const proc = spawn(exePath, [String(pid)], { windowsHide: true })
      processAudioCaptureProc = proc
      appendDebugLog('main', `startProcessAudioCapture: spawn ok (exe=${exePath}, pid=${pid})`)

      proc.stdout.on('data', (chunk) => {
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
            mainWindow?.webContents.send('process-audio:error', 'Formato de cabeçalho inesperado.')
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
          mainWindow?.webContents.send('process-audio:format', { sampleRate, channels, sampleFormat })

          if (rest.length > 0) {
            processAudioPendingChunks.push(Buffer.from(rest))
            scheduleProcessAudioFlush()
          }
          return
        }
        processAudioPendingChunks.push(Buffer.from(chunk))
        scheduleProcessAudioFlush()
      })

      // stderr é só texto de diagnóstico (ver capture.cpp) — repassa
      // linhas "ERROR ..." pro renderer pra pelo menos dar um motivo em
      // vez de simplesmente "não funcionou". Linhas "STATUS ..." só
      // ajudam a depurar (não precisa mostrar na cara da pessoa).
      let stderrBuffer = ''
      proc.stderr?.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf8')
        let newlineIndex
        while ((newlineIndex = stderrBuffer.indexOf('\n')) >= 0) {
          const line = stderrBuffer.slice(0, newlineIndex).trim()
          stderrBuffer = stderrBuffer.slice(newlineIndex + 1)
          if (line.startsWith('ERROR')) {
            appendDebugLog('main', `startProcessAudioCapture: capture.cpp reportou erro — ${line}`)
            mainWindow?.webContents.send('process-audio:error', line.replace(/^ERROR\s*/, ''))
          } else if (line.startsWith('STATUS')) {
            // Só pra esse log de diagnóstico — não precisa incomodar
            // quem está usando com isso (ver comentário original acima).
            appendDebugLog('main', `startProcessAudioCapture: ${line}`)
          }
        }
      })

      proc.on('error', (err) => {
        appendDebugLog('main', `startProcessAudioCapture: evento 'error' do processo — ${err?.message}`)
        mainWindow?.webContents.send('process-audio:error', err?.message || 'Falha ao iniciar a captura de áudio.')
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

  ipcMain.handle('process-audio:start', (_event, pid) => startProcessAudioCapture(pid))
  ipcMain.handle('process-audio:stop', () => stopProcessAudioCapture())

  // Ver o bloco grande "DÉCIMA QUARTA RODADA" perto do topo do arquivo —
  // deixa o RENDERER (VoiceContext.tsx) escrever no mesmo arquivo de log
  // que o processo principal já usa, sem depender do DevTools.
  ipcMain.on('debug:log', (_event, message) => {
    appendDebugLog('renderer', String(message))
  })

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
    // Sem isso o processo do PowerShell (vigia de foco do jogo) ficaria
    // rodando sozinho em segundo plano depois do app fechar.
    stopForegroundWatch()
    // Idem pro scanner persistente (DÉCIMA TERCEIRA RODADA — ver
    // ensureScanner/scannerQuery acima) e pro process-audio-capture.exe
    // (captura de áudio por processo).
    killScanner()
    stopProcessAudioCapture()
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
    // Antes eram 6 tentativas de 25s (até 2min30 de espera, com a pessoa
    // vendo "Verificando atualizações..." travado na tela o tempo todo) —
    // um exagero pra um atraso de indexação do GitHub que, na prática, é
    // de segundos, não minutos. Reduzido bem: só 2 tentativas rápidas.
    const MAX_UPDATE_RETRIES = 2
    const UPDATE_RETRY_DELAY_MS = 4_000

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

      // Um release recém-publicado pode demorar alguns segundos pra o
      // GitHub "enxergar" ele como o mais recente (atraso normal de
      // indexação do próprio GitHub, não é bug daqui) — isso costuma
      // aparecer como 404 bem na primeira checagem depois de abrir o
      // app. Em vez de desistir na hora, tenta de novo com uma pausa
      // curta antes de qualquer coisa — mas só duas vezes, rápido, pra
      // não deixar a pessoa esperando minutos vendo "verificando".
      if (raw.includes('404') && updateRetryCount < MAX_UPDATE_RETRIES) {
        updateRetryCount++
        setTimeout(() => {
          autoUpdater.checkForUpdates().catch(() => {})
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
        sendUpdateStatus('up-to-date')
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

    // Sem os dois `true`, o electron-updater roda o instalador no modo
    // NORMAL (não silencioso) por padrão — é exatamente por isso que
    // clicar em "Reiniciar" abria a telinha de instalação de novo, como
    // se fosse a primeira vez, em vez de só trocar a versão e voltar
    // direto pro app. `true, true` = instala em silêncio (sem nenhuma
    // janela aparecer) e reabre o app sozinho assim que terminar — junto
    // com "oneClick: true" no nsis (package.json), fica igual o Discord
    // de verdade: a pessoa nem percebe que uma instalação aconteceu.
    ipcMain.handle('app:restartToUpdate', () => autoUpdater.quitAndInstall(true, true))
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
  if (foregroundCheckTimer) clearInterval(foregroundCheckTimer)
  stopForegroundWatch()
  killScanner()
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
      autoUpdater.quitAndInstall(true, true)
    } else {
      app.quit()
    }
  }
})

