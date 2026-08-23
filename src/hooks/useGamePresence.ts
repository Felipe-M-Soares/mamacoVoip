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
  // Windows? Usado pra escolher qual tela sugerir automaticamente no
  // atalho "Compartilhar seu jogo" quando a pessoa tem mais de um
  // monitor (ver findGameSource/fallbackScreen em ScreenSharePicker.tsx)
  // — sem isso, o fallback podia acabar pegando o monitor ERRADO (o do
  // navegador/chat, por exemplo) em vez do que o jogo está de fato.
  isPrimaryDisplay?: boolean
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
      onScreenShareSources: (callback: (sources: ScreenShareSource[]) => void) => () => void
      selectScreenShareSource: (sourceId: string | null) => Promise<void>
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
      startForegroundWatch: (gameLabel: string) => Promise<boolean>
      stopForegroundWatch: () => Promise<void>
      onGameForegroundChanged: (callback: (focused: boolean) => void) => () => void
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
