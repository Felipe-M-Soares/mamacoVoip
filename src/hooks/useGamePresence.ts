import { supabase } from '../lib/supabase'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAuth } from './useAuth'
import { getShowPlaying, subscribeShowPlaying } from '../lib/gamePrivacy'

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
  type: 'screen' | 'window'
  isPrimaryDisplay?: boolean
  isGameDisplay?: boolean
  isExactGameWindow?: boolean
  pid?: number | null
}

export interface ScreenShareSuggestion {
  label: string
  isKnownGame: boolean
  processNames: string[]
  pid: number | null
  hwnd: number | null
  looksMinimized: boolean
  antiCheat?: string | null
}

export interface CurrentGameInfo {
  label: string
  antiCheat: string | null
  generic: boolean
  store?: string | null
  steamAppId?: number | null
}

export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface OverlaySettings {
  corner: OverlayCorner
  opacity?: number
  visible: boolean
  shortcutRegistered?: boolean
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
      setGameDetectionEnabled?: (enabled: boolean) => Promise<boolean>
      onGameStatusChanged: (callback: (game: string | null) => void) => () => void
      onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => () => void
      restartToUpdate: () => Promise<boolean | void>
      getUpdateStatus?: () => Promise<UpdateStatusPayload | null>
      getScreenShareSources: () => Promise<ScreenShareSourcesPayload>
      copyText?: (text: string) => Promise<boolean>
      showNotification?: (payload: {
        title: string
        body: string
        target?: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }
      }) => Promise<boolean>
      onNotificationClick?: (callback: (target: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }) => void) => () => void
      flashWindow?: () => void
      setGlobalKeybinds?: (list: { id: string; accelerator: string }[]) => Promise<{ failed: string[] }>
      onKeybind?: (callback: (id: string) => void) => () => void
      selectScreenShareSource: (sourceId: string | null) => Promise<void>
      pinFallbackShareSource: (sourceId: string) => Promise<void>
      focusAppWindow: () => void
      isGlobalPTTAvailable: () => Promise<boolean>
      startPTTCapture: () => Promise<{ keycode: number; name: string } | null>
      setGlobalPTTKey: (keycode: number | null) => Promise<void>
      onPTTState: (callback: (active: boolean) => void) => () => void
      sendVoiceStateToOverlay: (state: unknown) => void
      getOverlaySettings?: () => Promise<OverlaySettings>
      setOverlayVisible?: (visible: boolean) => Promise<boolean>
      toggleOverlay?: () => Promise<boolean>
      setOverlayCorner?: (corner: OverlayCorner) => Promise<{ corner: OverlayCorner }>
      setOverlayOpacity?: (opacity: number) => Promise<{ corner: OverlayCorner; opacity: number }>
      getVideoEncodeSettings?: () => Promise<{ preferGpu: boolean; activeNow: boolean; autoDisabled?: boolean }>
      setPreferGpuEncode?: (preferGpu: boolean) => Promise<{ preferGpu: boolean; activeNow: boolean }>
      relaunchApp?: () => Promise<void>
      setTitleBarColors?: (colors: { color: string; symbolColor: string }) => Promise<boolean>
      getAutoStart?: () => Promise<{ enabled: boolean; supported: boolean }>
      setAutoStart?: (enabled: boolean) => Promise<{ enabled: boolean; supported: boolean }>
      getSystemIdleSeconds?: () => Promise<number | null>
      onOverlayVisibilityChanged?: (callback: (visible: boolean) => void) => () => void
      getCurrentGameInfo?: () => Promise<CurrentGameInfo | null>
      checkForUpdatesNow: () => void
      startForegroundWatch: (processNames: string[]) => Promise<boolean>
      stopForegroundWatch: () => Promise<void>
      onGameForegroundChanged: (callback: (focused: boolean) => void) => () => void
      watchProcessExit: (processNames: string[]) => Promise<void>
      stopWatchProcessExit: () => Promise<void>
      onWatchedProcessExited: (callback: () => void) => () => void
      startProcessAudioCapture: (pid: number) => Promise<{ ok: boolean; error?: string }>
      startSystemAudioExcludingSelf?: () => Promise<{ ok: boolean; error?: string }>
      stopProcessAudioCapture: () => Promise<void>
      onProcessAudioFormat: (
        callback: (format: { sampleRate: number; channels: number; sampleFormat: 'float32' | 'int16' }) => void
      ) => () => void
      onProcessAudioChunk: (callback: (chunk: Uint8Array) => void) => () => void
      onProcessAudioError: (callback: (message: string) => void) => () => void
      startScreenCaptureWgcFallback: (monitorIndex?: number) => Promise<{ ok: boolean; error?: string }>
      stopScreenCaptureWgcFallback: () => Promise<void>
      onScreenCaptureWgcFormat: (callback: (format: { width: number; height: number }) => void) => () => void
      onScreenCaptureWgcFrame: (callback: (frame: Uint8Array) => void) => () => void
      onScreenCaptureWgcError: (callback: (message: string) => void) => () => void
      startScreenCaptureGdiFallback: (monitorIndex?: number) => Promise<{ ok: boolean; error?: string }>
      stopScreenCaptureGdiFallback: () => Promise<void>
      onScreenCaptureGdiFormat: (callback: (format: { width: number; height: number }) => void) => () => void
      onScreenCaptureGdiFrame: (callback: (frame: Uint8Array) => void) => () => void
      onScreenCaptureGdiError: (callback: (message: string) => void) => () => void
      onGoogleAuthCallback: (callback: (url: string) => void) => () => void
      logDebug: (message: string) => void
      secureStorage?: {
        getItem: (key: string) => Promise<{ ok: boolean; value?: string | null }>
        setItem: (key: string, value: string) => Promise<{ ok: boolean }>
        removeItem: (key: string) => Promise<{ ok: boolean }>
      }
    }
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron)
}

export function useGamePresence() {
  const { user, profile, updateProfile } = useAuth()
  const showPlaying = useSyncExternalStore(subscribeShowPlaying, getShowPlaying, () => true)
  const hasPlaying = !!profile?.playing
  const staleChecked = useRef<string | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.setGameDetectionEnabled) return
    window.electronAPI.setGameDetectionEnabled(showPlaying).catch(() => {})
  }, [showPlaying])

  useEffect(() => {
    if (!user || showPlaying || !hasPlaying) return
    updateProfile({ playing: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showPlaying, hasPlaying])

  useEffect(() => {
    const api = window.electronAPI
    if (!user || !api || !showPlaying || !hasPlaying || staleChecked.current === user.id) return
    staleChecked.current = user.id
    api
      .getCurrentGame()
      .then((game) => {
        if (game) return
        void updateProfile({ playing: null })
        void supabase.from('profiles').update({ playing_app: null, playing_since: null }).eq('id', user.id).then(() => {}, () => {})
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showPlaying, hasPlaying])

  useEffect(() => {
    if (!user || !window.electronAPI || !showPlaying) return

    let cancelled = false
    const publish = async (game: string | null) => {
      if (cancelled || !getShowPlaying()) return
      await updateProfile({ playing: game })
      if (cancelled || !user) return
      let app: string | null = null
      if (game) {
        const info = await window.electronAPI?.getCurrentGameInfo?.().catch(() => null)
        if (info && info.label === game) {
          app = info.steamAppId ? `steam:${info.steamAppId}` : info.store ? info.store.toLowerCase().replace(/[^a-z0-9 ._-]/g, '').slice(0, 40) || null : null
        }
      }
      await supabase
        .from('profiles')
        .update({ playing_app: app, playing_since: game ? new Date().toISOString() : null })
        .eq('id', user.id)
        .then(
          () => {},
          () => {}
        )
    }
    const unsubscribe = window.electronAPI.onGameStatusChanged((game) => {
      void publish(game)
    })

    window.electronAPI
      .getCurrentGame()
      .then((game) => {
        if (game) void publish(game)
      })
      .catch(() => {
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showPlaying])
}
