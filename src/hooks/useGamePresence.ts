import { useEffect } from 'react'
import { useAuth } from './useAuth'

export interface UpdateStatusPayload {
  status: 'checking' | 'downloading' | 'up-to-date' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
  downloadUrl?: string
}

export interface ScreenShareSource {
  id: string
  name: string
  thumbnail: string
  // "screen" = uma tela inteira, "window" = uma janela específica. Jogos
  // em modo tela cheia exclusiva não aparecem como "window" — só como
  // parte da tela inteira — por isso o picker precisa saber diferenciar
  // (ver ScreenSharePicker.tsx).
  type: 'screen' | 'window'
  // Só faz sentido quando type === 'screen': é a tela PRINCIPAL do
  // Windows? Usado como ÚLTIMO fallback (ver isGameDisplay abaixo, que é
  // preferido quando disponível) pra escolher qual tela sugerir
  // automaticamente no atalho "Compartilhar seu jogo" quando a pessoa
  // tem mais de um monitor (ver findGameSource/fallbackScreen em
  // ScreenSharePicker.tsx) — sem isso, o fallback podia acabar pegando
  // o monitor ERRADO (o do navegador/chat, por exemplo) em vez do que o
  // jogo está de fato.
  isPrimaryDisplay?: boolean
  // Só faz sentido quando type === 'screen': o Windows confirmou que a
  // JANELA DO PRÓPRIO JOGO detectado está de fato neste monitor (ver
  // getGameWindowDisplayBounds em electron/main.cjs) — muito mais
  // confiável que assumir "tela principal", já que muita gente joga com
  // o jogo no monitor SECUNDÁRIO. `false`/ausente quando não deu pra
  // descobrir (Mac/Linux, ou o Windows não conseguiu achar a janela).
  isGameDisplay?: boolean
  // Só faz sentido quando type === 'window': o TÍTULO desta janela bate
  // EXATO com o título da janela do processo do jogo detectado (ver
  // getGameWindowInfo em electron/main.cjs) — muito mais confiável que
  // o "nome parecido" (findGameSource em ScreenSharePicker.tsx), que
  // era só uma aposta por não ter como saber o título real de antes.
  isExactGameWindow?: boolean
  // PID do processo dono da janela (só type === 'window', quando o
  // Windows consegue casar o título — ver getWindowPidMap em
  // electron/main.cjs). Usado pra oferecer a captura de áudio
  // experimental "só deste app" (ver ScreenSharePicker.tsx e a seção
  // "Captura de áudio por processo" em VoiceContext.tsx). null/ausente
  // quando não deu pra descobrir.
  pid?: number | null
}

// Sugestão de atalho "compartilhar seu jogo/janela" calculada no processo
// principal (ver setDisplayMediaRequestHandler em electron/main.cjs) — pode
// vir de um jogo CADASTRADO (KNOWN_GAMES, isKnownGame true, label bonito
// tipo "Elden Ring") ou, generalizando pra qualquer app/jogo não
// cadastrado, da última janela que esteve em primeiro plano antes de abrir
// o seletor (isKnownGame false, label é o título da janela ou o nome do
// processo). `processNames` é usado pra pedir o auto-stop quando aquele
// processo fechar (ver ScreenSharePicker.tsx/VoiceContext.tsx).
export interface ScreenShareSuggestion {
  label: string
  isKnownGame: boolean
  processNames: string[]
  // PID resolvido pro caso de fallback de TELA CHEIA (jogo sem janela
  // própria capturável) — ver windowInfo.pid em electron/main.cjs.
  // Pro caso de uma janela normal (type 'window'), o PID já vem junto
  // com o próprio ScreenShareSource.pid acima.
  pid: number | null
  // DÉCIMA OITAVA RODADA: handle nativo (Windows) da janela do jogo
  // detectado, usado só pra "Restaurar e compartilhar" (ver
  // looksMinimized abaixo) — null em qualquer plataforma que não seja
  // Windows, ou quando não deu pra resolver.
  hwnd: number | null
  // true quando o processo do jogo CADASTRADO está rodando de verdade,
  // mas nenhuma fonte capturável (desktopCapturer.getSources()) bate com
  // ele — sinal forte de que a janela está MINIMIZADA (Chromium exclui
  // janelas minimizadas da lista, sempre — não é bug nosso, ver o
  // comentário grande em electron/main.cjs). Nesse caso o
  // ScreenSharePicker.tsx oferece um botão de restaurar em vez de
  // simplesmente não ter nada pra escolher.
  looksMinimized: boolean
}

export interface ScreenShareSourcesPayload {
  sources: ScreenShareSource[]
  suggestion: ScreenShareSuggestion | null
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      platform: string
      getVersion: () => Promise<string>
      getCurrentGame: () => Promise<string | null>
      onGameStatusChanged: (callback: (game: string | null) => void) => () => void
      onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => () => void
      restartToUpdate: () => Promise<void>
      // OITAVA RODADA: pedido ativo (invoke/Promise) em vez de esperar
      // um evento chegar sozinho — ver electron/preload.cjs e o
      // comentário grande em electron/main.cjs sobre abandonar
      // setDisplayMediaRequestHandler.
      getScreenShareSources: () => Promise<ScreenShareSourcesPayload>
      // Áudio automático conforme o tipo da fonte (tela cheia = sistema,
      // janela = captura por processo) — ver electron/main.cjs.
      selectScreenShareSource: (sourceId: string | null) => Promise<void>
      // NONA RODADA: plano B automático de captura — ver o comentário
      // grande em captureScreenShareStream (VoiceContext.tsx) e em
      // electron/main.cjs perto de setDisplayMediaRequestHandler.
      pinFallbackShareSource: (sourceId: string) => Promise<void>
      // DÉCIMA OITAVA RODADA — ver ScreenShareSuggestion.looksMinimized
      // acima e o botão "Restaurar e compartilhar" em ScreenSharePicker.tsx.
      restoreGameWindow?: (hwnd: number) => Promise<{ ok: boolean }>
      focusAppWindow: () => void
      isGlobalPTTAvailable: () => Promise<boolean>
      startPTTCapture: () => Promise<{ keycode: number; name: string } | null>
      setGlobalPTTKey: (keycode: number | null) => Promise<void>
      onPTTState: (callback: (active: boolean) => void) => () => void
      sendVoiceStateToOverlay: (state: unknown) => void
      checkForUpdatesNow: () => void
      // Vigia de foco do jogo — enquanto um compartilhamento de tela
      // cheia "atalho de jogo" está ativo, o processo principal observa
      // (via PowerShell, só Windows) se o jogo é a janela em foco no
      // momento, e avisa aqui quando isso muda. A VoiceContext usa isso
      // pra trocar o vídeo enviado por um placeholder quando a pessoa
      // alterna pra outro programa, evitando vazar o resto da tela.
      // Recebe os nomes de processo do jogo/app compartilhado (não mais um
      // label do KNOWN_GAMES — funciona pra qualquer jogo, cadastrado ou não).
      startForegroundWatch: (processNames: string[]) => Promise<boolean>
      stopForegroundWatch: () => Promise<void>
      onGameForegroundChanged: (callback: (focused: boolean) => void) => () => void
      // Auto-parar (não só ocultar) o compartilhamento de tela cheia
      // quando o processo compartilhado fecha de vez — ver electron/main.cjs.
      watchProcessExit: (processNames: string[]) => Promise<void>
      stopWatchProcessExit: () => Promise<void>
      onWatchedProcessExited: (callback: () => void) => () => void
      // Captura de áudio por processo (EXPERIMENTAL, só Windows) — ver
      // o bloco grande em electron/main.cjs e
      // native/process-audio-capture/capture.cpp. `startProcessAudioCapture`
      // nunca lança: sempre devolve { ok, error? }.
      startProcessAudioCapture: (pid: number) => Promise<{ ok: boolean; error?: string }>
      stopProcessAudioCapture: () => Promise<void>
      onProcessAudioFormat: (
        callback: (format: { sampleRate: number; channels: number; sampleFormat: 'float32' | 'int16' }) => void
      ) => () => void
      onProcessAudioChunk: (callback: (chunk: Uint8Array) => void) => () => void
      onProcessAudioError: (callback: (message: string) => void) => () => void
      // Login com Google — recebe a URL de callback (mamacovoip://...)
      // que o processo principal repassa assim que o sistema
      // operacional entrega o link de volta do navegador. Ver
      // AuthContext.tsx (signInWithGoogle) e o bloco grande no topo de
      // electron/main.cjs.
      onGoogleAuthCallback: (callback: (url: string) => void) => () => void
      // Log em arquivo (mamacos-debug.log, na pasta de dados do app) —
      // ver o bloco grande perto do topo de electron/main.cjs. Existe
      // pra diagnosticar problemas à distância sem depender do DevTools
      // (nem sempre óbvio como abrir, ou alcançável por atalho de
      // teclado, num app empacotado).
      logDebug: (message: string) => void
    }
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron)
}

// Só faz alguma coisa dentro do app desktop — no navegador,
// window.electronAPI simplesmente não existe, e o hook não faz nada.
export function useGamePresence() {
  const { user, updateProfile } = useAuth()

  useEffect(() => {
    if (!user || !window.electronAPI) return

    const unsubscribe = window.electronAPI.onGameStatusChanged((game) => {
      updateProfile({ playing: game })
    })

    window.electronAPI.getCurrentGame().then((game) => {
      if (game) updateProfile({ playing: game })
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
}
