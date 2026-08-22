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
