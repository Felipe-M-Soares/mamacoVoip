import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ConnectionQuality as LiveKitConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  VideoQuality,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client'
import { supabase } from '../lib/supabase'
import { applyOutput, listDevices, micNeedsSwap, onAudioDevicesSettled } from '../lib/audioDevices'
import { takeLiveKitToken, prewarmLiveKitConnection, rememberLiveKitUrl, setActiveVoiceRoom } from '../lib/livekit'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
import {
  useScreenShareQuality,
  contentHintForPreset,
  resolveScreenSharePreset,
  exceedsH264FrameLimits,
  fitWithin,
  SAFE_MAX_CAPTURE_HEIGHT,
  SAFE_MAX_CAPTURE_WIDTH,
  type QualityPreset,
} from '../hooks/useScreenShareQuality'
import {
  createNoiseSuppressor,
  type NoiseSuppressor,
  createScreenAudioDenoiser,
  type ScreenAudioDenoiser,
  createAutoSensitivity,
  AUTO_SENSITIVITY_TICK_MS,
  DEFAULT_MIC_SENSITIVITY,
} from '../lib/noiseSuppression'
import { chooseScreenCodec, markCodecSoftwareOnly, probeHardwareEncoders, resetHardwareProbe, type ScreenCodec } from '../lib/hwEncode'
import { computeScreenShareStats, pickOutboundVideo, type OutboundVideoSample } from '../lib/screenShareStats'
import { getStreamView, subscribeStreamView, type StreamQuality } from '../lib/streamView'
import { peekPendingGameShareHint, takePendingGameShareHint } from '../lib/screenShareGameHint'
import { takePendingAppAudioPid } from '../lib/pendingAppAudioCapture'
import { openScreenSharePicker } from '../lib/screenSharePickerBridge'
import { armScreenShareChoice } from '../lib/chooseScreenShareSource'
import { PcmStreamPlayer } from '../lib/pcmStreamPlayer'
import { isAllowedSoundboardUrl } from '../lib/soundboardUrl'
import { ensureRealtimeAuth, privateChannelParams, changesChannel } from '../lib/realtimeChannel'
import { useSplitVoiceValue, VoiceActivityContext, VoiceCoreContext } from './voiceSplit'
import {
  playConnectSound,
  playDisconnectSound,
  playMuteSound,
  playUnmuteSound,
  playDeafenSound,
  playUndeafenSound,
  playUserJoinSound,
  playUserLeaveSound,
  playStreamStartSound,
  playStreamStopSound,
} from '../lib/sounds'

function logDebug(message: string) {
  console.error(`[VoiceContext] ${message}`)
  window.electronAPI?.logDebug?.(message)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tempo esgotado (${label}). Verifique sua conexão com a internet e tente de novo.`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

const MAX_PARTICIPANTS = 50

const MIC_MAX_BITRATE = 64_000

const SCREEN_SHARE_AUDIO_MAX_BITRATE = 192_000

const SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS = {
  name: 'screen-audio',
  source: Track.Source.ScreenShareAudio,
  audioPreset: { maxBitrate: SCREEN_SHARE_AUDIO_MAX_BITRATE },
  forceStereo: true,
  dtx: false,
  red: false,
}

const NO_PUBLISH_PERMISSION_MESSAGE = 'Você está como ouvinte neste canal — só moderadores podem falar ou transmitir aqui.'

const STREAM_QUALITY_TO_LIVEKIT: Record<StreamQuality, VideoQuality> = {
  auto: VideoQuality.HIGH,
  media: VideoQuality.MEDIUM,
  baixa: VideoQuality.LOW,
}

const SIMULCAST_OFF_KEY = 'mv-screen-simulcast-off'
function screenSimulcastAllowed(): boolean {
  try {
    return localStorage.getItem(SIMULCAST_OFF_KEY) !== '1'
  } catch {
    return true
  }
}
function disableScreenSimulcast() {
  try {
    localStorage.setItem(SIMULCAST_OFF_KEY, '1')
  } catch {
  }
}

function screenSimulcastLayers(preset: QualityPreset): VideoPreset[] {
  const layers: VideoPreset[] = []
  if (preset.height > 360) layers.push(new VideoPreset(640, 360, 600_000, Math.min(15, preset.frameRate)))
  if (preset.height > 720) {
    layers.push(new VideoPreset(1280, 720, Math.min(2_500_000, Math.round(preset.maxBitrate * 0.4)), Math.min(30, preset.frameRate)))
  }
  return layers
}

function createVoiceRoom(): Room {
  return new Room({
    adaptiveStream: false,
    dynacast: true,
    publishDefaults: {
      dtx: true,
      red: true,
    },
  })
}

class JoinAbortedError extends Error {
  constructor() {
    super('Entrada no canal cancelada.')
    this.name = 'JoinAbortedError'
  }
}

async function getMicStreamWithFallback(
  constraints: MediaTrackConstraints,
  attempts = 2
): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  try {
    return { stream: await getUserMediaWithRetry({ audio: constraints }, attempts), usedFallback: false }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (!constraints.deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError' && name !== 'NotReadableError')) {
      throw err
    }
    const withoutDevice: MediaTrackConstraints = { ...constraints }
    delete withoutDevice.deviceId
    logDebug(`getMicStreamWithFallback: microfone salvo indisponível (${name}), usando o padrão do sistema`)
    return { stream: await getUserMediaWithRetry({ audio: withoutDevice }, 1), usedFallback: true }
  }
}

function describeMicError(err: unknown): string | null {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permissão de microfone negada. Habilite o acesso ao microfone nas configurações do sistema e tente de novo.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Nenhum microfone encontrado. Conecte um microfone e tente de novo.'
  }
  if (name === 'NotReadableError') {
    return 'Não foi possível abrir o microfone — ele pode estar sendo usado por outro programa.'
  }
  return null
}

const MAX_CONCURRENT_SOUNDBOARD = 6

const APP_AUDIO_CONFIRM_TIMEOUT_MS = 3000

function readVideoSettings(track: MediaStreamTrack): { width: number; height: number; frameRate: number } {
  try {
    const s = track.getSettings()
    return { width: s.width ?? 0, height: s.height ?? 0, frameRate: Math.round(s.frameRate ?? 0) }
  } catch {
    return { width: 0, height: 0, frameRate: 0 }
  }
}

function withScreenShareTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DOMException(`${label}: tempo esgotado`, 'TimeoutError')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function applyVideoQualityConstraints(
  track: MediaStreamTrack,
  preset: QualityPreset,
  context: string
): Promise<{ width: number; height: number; frameRate: number }> {
  const before = readVideoSettings(track)
  const maxWidth = Math.min(preset.width, SAFE_MAX_CAPTURE_WIDTH)
  const maxHeight = Math.min(preset.height, SAFE_MAX_CAPTURE_HEIGHT)
  logDebug(
    `${context}: captura aberta em ${before.width}x${before.height}@${before.frameRate}fps — aplicando teto ${maxWidth}x${maxHeight}@${preset.frameRate}fps (label=${track.label || '?'})`
  )
  try {
    await withScreenShareTimeout(
      track.applyConstraints({
        width: { ideal: maxWidth, max: maxWidth },
        height: { ideal: maxHeight, max: maxHeight },
        frameRate: { ideal: preset.frameRate },
      }),
      3000,
      'applyConstraints'
    )
  } catch (err) {
    logDebug(`${context}: applyConstraints (tamanho+fps) falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}; tentando só o tamanho`)
    try {
      await withScreenShareTimeout(
        track.applyConstraints({ width: { max: maxWidth }, height: { max: maxHeight } }),
        3000,
        'applyConstraints'
      )
    } catch (err2) {
      logDebug(`${context}: applyConstraints (só tamanho) também falhou — ${err2 instanceof Error ? `${err2.name}: ${err2.message}` : String(err2)}`)
    }
  }
  const after = readVideoSettings(track)
  const overCap = after.width > SAFE_MAX_CAPTURE_WIDTH || after.height > SAFE_MAX_CAPTURE_HEIGHT
  logDebug(
    `${context}: resolução final ${after.width}x${after.height}@${after.frameRate}fps${overCap ? ' — ATENÇÃO: acima do teto de segurança (redução não pegou)' : ''}`
  )
  return after
}

function pickScreenShareCodec(settings: { width: number; height: number }, context: string): ScreenCodec {
  if (exceedsH264FrameLimits(settings.width, settings.height)) {
    logDebug(`${context}: quadro ${settings.width}x${settings.height} acima do limite do H.264 — publicando em VP8`)
    return 'vp8'
  }
  return 'h264'
}

async function captureNativeFallbackStream(kind: 'wgc' | 'gdi', monitorIndex: number): Promise<MediaStream> {
  const api =
    kind === 'wgc'
      ? {
          start: window.electronAPI?.startScreenCaptureWgcFallback,
          stop: window.electronAPI?.stopScreenCaptureWgcFallback,
          onFormat: window.electronAPI?.onScreenCaptureWgcFormat,
          onFrame: window.electronAPI?.onScreenCaptureWgcFrame,
          onError: window.electronAPI?.onScreenCaptureWgcError,
        }
      : {
          start: window.electronAPI?.startScreenCaptureGdiFallback,
          stop: window.electronAPI?.stopScreenCaptureGdiFallback,
          onFormat: window.electronAPI?.onScreenCaptureGdiFormat,
          onFrame: window.electronAPI?.onScreenCaptureGdiFrame,
          onError: window.electronAPI?.onScreenCaptureGdiError,
        }
  if (!api.start || !api.stop || !api.onFormat || !api.onFrame || !api.onError) {
    throw new DOMException(`Fallback de captura de tela (${kind}) indisponível nesta instalação.`, 'NotSupportedError')
  }
  const startResult = await api.start(monitorIndex)
  if (!startResult?.ok) {
    throw new DOMException(
      startResult?.error || `Não foi possível iniciar o fallback de captura de tela (${kind}).`,
      'NotReadableError'
    )
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  let ready = false
  let decoding = false
  let cleanedUp = false

  const unsubFormat = api.onFormat(({ width, height }) => {
    const fitted = fitWithin(width, height)
    canvas.width = fitted.width || width
    canvas.height = fitted.height || height
    logDebug(`captureNativeFallbackStream(${kind}): monitor ${width}x${height} → canvas ${canvas.width}x${canvas.height}`)
    ready = true
  })
  const unsubFrame = api.onFrame((frame) => {
    if (!ready || !ctx || decoding) return
    decoding = true
    createImageBitmap(new Blob([frame.slice().buffer], { type: 'image/jpeg' }), {
      resizeWidth: canvas.width,
      resizeHeight: canvas.height,
      resizeQuality: 'medium',
    })
      .then((bitmap) => {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
      })
      .catch(() => {
      })
      .finally(() => {
        decoding = false
      })
  })
  const unsubError = api.onError((message) => {
    logDebug(`captureNativeFallbackStream(${kind}): erro reportado pelo capturador nativo — ${message}`)
  })

  function cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    unsubFormat()
    unsubFrame()
    unsubError()
    api.stop?.().catch(() => {})
  }

  const waitStart = Date.now()
  while (!ready && Date.now() - waitStart < 4000) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) {
    cleanup()
    throw new DOMException(`O fallback de captura de tela (${kind}) não chegou a produzir nenhum quadro.`, 'NotReadableError')
  }

  const stream = canvas.captureStream(kind === 'wgc' ? 30 : 24)
  const [videoTrack] = stream.getVideoTracks()
  const originalStop = videoTrack.stop.bind(videoTrack)
  videoTrack.stop = () => {
    cleanup()
    originalStop()
  }
  return stream
}

async function captureScreenShareStreamWeb(preset: QualityPreset): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new DOMException(
      'Este navegador não permite compartilhar a tela (celulares não suportam). Use o Chrome, Edge ou Firefox no computador, ou o app desktop.',
      'NotSupportedError'
    )
  }
  const options = {
    video: {
      frameRate: { ideal: preset.frameRate, max: preset.frameRate },
      width: { max: preset.width },
      height: { max: preset.height },
    },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  } as DisplayMediaStreamOptions
  logDebug(`captureScreenShareStreamWeb: pedindo captura ${preset.width}x${preset.height}@${preset.frameRate}`)
  return navigator.mediaDevices.getDisplayMedia(options)
}

async function captureScreenShareStream(
  preset: QualityPreset,
  opts?: { auto?: boolean },
  presetFor?: (isGame: boolean) => QualityPreset,
  out?: { preset: QualityPreset; isGame: boolean }
): Promise<MediaStream> {
  if (out) {
    out.preset = preset
    out.isGame = false
  }
  if (!window.electronAPI) {
    return captureScreenShareStreamWeb(preset)
  }
  if (window.electronAPI.platform === 'linux') {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  }
  const payload = await window.electronAPI.getScreenShareSources()
  let sourceId: string | null
  if (opts?.auto) {
    const { sources, suggestion } = payload
    const gameCard = suggestion
      ? (sources.find((s) => s.isExactGameWindow) ?? sources.find((s) => s.isGameDisplay) ?? null)
      : null
    if (gameCard && suggestion) {
      armScreenShareChoice(
        gameCard.id,
        sources,
        gameCard,
        suggestion,
        suggestion.isKnownGame ? { processNames: suggestion.processNames, label: suggestion.label } : undefined
      )
      sourceId = gameCard.id
    } else {
      sourceId = await openScreenSharePicker(payload)
    }
  } else {
    sourceId = await openScreenSharePicker(payload)
  }
  if (!sourceId) {
    throw new DOMException('Compartilhamento cancelado.', 'NotAllowedError')
  }
  {
    const chosen = payload.sources.find((s) => s.id === sourceId)
    const isGame =
      Boolean(payload.suggestion?.isKnownGame) &&
      (peekPendingGameShareHint() !== null || Boolean(chosen && (chosen.isExactGameWindow || chosen.isGameDisplay)))
    if (presetFor) preset = presetFor(isGame)
    if (out) {
      out.preset = preset
      out.isGame = isGame
    }
    if (isGame) {
      logDebug(
        `captureScreenShareStream: fonte é jogo (${payload.suggestion?.label ?? '?'}${payload.suggestion?.antiCheat ? `, anti-cheat ${payload.suggestion.antiCheat}` : ''}) — preset ${preset.label}`
      )
    }
  }
  const isScreenSource = sourceId.startsWith('screen:')
  logDebug(
    `captureScreenShareStream: fonte escolhida sourceId=${sourceId} (tipo=${isScreenSource ? 'tela inteira' : 'janela'}, preset=${preset.width}x${preset.height}@${preset.frameRate}fps)`
  )
  const suggestedHwnd = payload.suggestion?.hwnd ?? null
  async function attemptGetUserMedia(id: string, withResolutionLimits: boolean): Promise<MediaStream> {
    const constraints = {
      audio: false,
      video: {
        mandatory: withResolutionLimits
          ? {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: id,
              minWidth: 1,
              maxWidth: preset.width,
              minHeight: 1,
              maxHeight: preset.height,
              minFrameRate: 1,
              maxFrameRate: preset.frameRate,
            }
          : {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: id,
            },
      },
    } as unknown as MediaStreamConstraints
    return await navigator.mediaDevices.getUserMedia(constraints)
  }
  try {
    try {
      return await attemptGetUserMedia(sourceId, !isScreenSource)
    } catch (err) {
      const errName = err instanceof Error ? err.name : String(err)
      logDebug(`captureScreenShareStream: 1ª tentativa falhou (sourceId=${sourceId}, isScreenSource=${isScreenSource}) — ${errName}`)
      if (!(err instanceof Error) || err.name !== 'NotReadableError') throw err
      await new Promise((resolve) => setTimeout(resolve, 700))
      try {
        return await attemptGetUserMedia(sourceId, false)
      } catch (retryErr) {
        const retryErrName = retryErr instanceof Error ? retryErr.name : String(retryErr)
        logDebug(
          `captureScreenShareStream: 2ª tentativa (sem espera de 700ms) também falhou — ${retryErrName}. suggestedHwnd=${suggestedHwnd}`
        )
        if (suggestedHwnd && `window:${suggestedHwnd}:0` !== sourceId) {
          try {
            const result = await attemptGetUserMedia(`window:${suggestedHwnd}:0`, false)
            logDebug('captureScreenShareStream: 3ª tentativa (window:<hwnd>:0) funcionou')
            return result
          } catch (hwndErr) {
            const hwndErrName = hwndErr instanceof Error ? hwndErr.name : String(hwndErr)
            logDebug(`captureScreenShareStream: 3ª tentativa (window:<hwnd>:0) também falhou — ${hwndErrName}`)
            throw retryErr
          }
        }
        throw retryErr
      }
    }
  } catch (primaryErr) {
    try {
      await window.electronAPI.pinFallbackShareSource(sourceId)
      const displayMediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      let timedOut = false
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => {
          timedOut = true
          reject(new DOMException('Tempo esgotado no plano B de captura.', 'TimeoutError'))
        }, 6000)
      )
      displayMediaPromise
        .then((lateStream) => {
          if (!timedOut) return
          logDebug('captureScreenShareStream: plano B (getDisplayMedia) resolveu tarde demais, encerrando sozinho')
          lateStream.getTracks().forEach((t) => t.stop())
        })
        .catch(() => {
        })
      return await Promise.race([displayMediaPromise, timeout])
    } catch (fallbackErr) {
      try {
        logDebug('captureScreenShareStream: caminhos DXGI/WebRTC falharam, tentando fallback WGC...')
        const wgcStream = await captureNativeFallbackStream('wgc', 0)
        logDebug('captureScreenShareStream: fallback WGC funcionou')
        return wgcStream
      } catch (wgcErr) {
        const wgcErrName = wgcErr instanceof Error ? wgcErr.name : String(wgcErr)
        logDebug(`captureScreenShareStream: fallback WGC falhou — ${wgcErrName}, tentando fallback GDI...`)
        try {
          const gdiStream = await captureNativeFallbackStream('gdi', 0)
          logDebug('captureScreenShareStream: fallback GDI funcionou')
          return gdiStream
        } catch (gdiErr) {
          const gdiErrName = gdiErr instanceof Error ? gdiErr.name : String(gdiErr)
          logDebug(`captureScreenShareStream: fallback GDI também falhou — ${gdiErrName}`)
        }
      }
      void fallbackErr
      throw primaryErr
    }
  }
}

async function getUserMediaWithRetry(constraints: MediaStreamConstraints, attempts = 2): Promise<MediaStream> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw lastError
}

export interface VoiceParticipant {
  userId: string
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  micAudioStream: MediaStream | null
  screenAudioStream: MediaStream | null
  speaking: boolean
}

export type VoiceConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost'

export type SoundboardSoundRef = { id: string; storage_path: string }

function soundboardUrlFor(storagePath: string): string {
  return supabase.storage.from('soundboard').getPublicUrl(storagePath).data.publicUrl
}

export interface VoiceContextValue {
  connectedChannelId: string | null
  connectedChannelName: string | null
  joiningChannelId: string | null
  connectedAt: number | null
  roomStartedAt: number | null
  connectionQuality: Record<string, VoiceConnectionQuality>
  localConnectionQuality: VoiceConnectionQuality | null
  connectedServerId: string | null
  connecting: boolean
  reconnecting: boolean
  canPublish: boolean
  error: string | null
  clearError: () => void
  participants: Record<string, VoiceParticipant>
  muted: boolean
  deafened: boolean
  toggleDeafen: () => void
  videoEnabled: boolean
  localCameraStream: MediaStream | null
  screenSharing: boolean
  screenShareConnecting: boolean
  localScreenStream: MediaStream | null
  speaking: boolean
  join: (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => Promise<void>
  leave: () => void
  toggleMute: () => void
  pushToTalkEnabled: boolean
  setPushToTalkEnabled: (enabled: boolean) => void
  pushToTalkKey: string
  setPushToTalkKey: (code: string) => void
  pushToTalkActive: boolean
  globalPushToTalkAvailable: boolean
  pushToTalkGlobalKeyName: string | null
  captureGlobalPushToTalkKey: () => Promise<string | null>
  toggleVideo: () => Promise<void>
  toggleScreenShare: (opts?: { auto?: boolean }) => Promise<void>
  switchScreenShareSource: () => Promise<void>
  screenSharePresetLabel: string | null
  getScreenShareStatsReport: () => Promise<RTCStatsReport | null>
  playSoundboardSound: (sound: SoundboardSoundRef) => Promise<{ error: string | null }>
  changeMicrophone: (deviceId: string) => Promise<void>
  refreshAudioConstraints: (
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) => Promise<void>
  audioSettings: ReturnType<typeof useAudioSettings>
  screenShareQuality: ReturnType<typeof useScreenShareQuality>
  maxParticipants: number
  masterVolume: number
  setMasterVolume: (volume: number) => void
  soundboardVolume: number
  setSoundboardVolume: (volume: number) => void
  getParticipantVolume: (userId: string) => number
  setParticipantVolume: (userId: string, volume: number) => void
  getScreenShareVolume: (userId: string) => number
  setScreenShareVolume: (userId: string, volume: number) => void
}

export const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

export function VoiceProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const id = setTimeout(() => prewarmLiveKitConnection((url) => createVoiceRoom().prepareConnection(url)), 2_000)
    return () => clearTimeout(id)
  }, [])

  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const screenShareQuality = useScreenShareQuality()
  const screenShareQualityRef = useRef(screenShareQuality.preset)
  screenShareQualityRef.current = screenShareQuality.preset
  const screenShareGameAutoRef = useRef(screenShareQuality.gameAuto)
  screenShareGameAutoRef.current = screenShareQuality.gameAuto
  const [screenSharePresetLabel, setScreenSharePresetLabel] = useState<string | null>(null)
  const audioSettingsRef = useRef(audioSettings)
  audioSettingsRef.current = audioSettings

  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null)
  const [connectedChannelName, setConnectedChannelName] = useState<string | null>(null)
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null)
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null)
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [roomStartedAt, setRoomStartedAt] = useState<number | null>(null)
  const [connectionQuality, setConnectionQuality] = useState<Record<string, VoiceConnectionQuality>>({})
  const [localConnectionQuality, setLocalConnectionQuality] = useState<VoiceConnectionQuality | null>(null)
  const localConnectionQualityRef = useRef<VoiceConnectionQuality | null>(null)
  localConnectionQualityRef.current = localConnectionQuality
  const [connecting, setConnecting] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [canPublish, setCanPublishState] = useState(true)
  const canPublishRef = useRef(true)
  function setCanPublish(value: boolean) {
    canPublishRef.current = value
    setCanPublishState(value)
  }
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null)
  const [screenSharing, setScreenSharing] = useState(false)
  const [screenShareConnecting, setScreenShareConnecting] = useState(false)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)

  const [pushToTalkEnabled, setPushToTalkEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-enabled') === 'true'
    } catch {
      return false
    }
  })
  const [pushToTalkKey, setPushToTalkKeyState] = useState<string>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-key') || 'ControlLeft'
    } catch {
      return 'ControlLeft'
    }
  })
  const [pushToTalkActive, setPushToTalkActiveState] = useState(false)
  function setPushToTalkActive(value: boolean) {
    pushToTalkActiveRef.current = value
    setPushToTalkActiveState(value)
  }
  const pushToTalkEnabledRef = useRef(pushToTalkEnabled)
  pushToTalkEnabledRef.current = pushToTalkEnabled
  const pushToTalkKeyRef = useRef(pushToTalkKey)
  pushToTalkKeyRef.current = pushToTalkKey

  const [globalPushToTalkAvailable, setGlobalPushToTalkAvailable] = useState(false)
  const [pushToTalkGlobalKeyName, setPushToTalkGlobalKeyNameState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-global-keyname')
    } catch {
      return null
    }
  })
  const pushToTalkGlobalKeycodeRef = useRef<number | null | undefined>(undefined)
  if (pushToTalkGlobalKeycodeRef.current === undefined) {
    try {
      const raw = localStorage.getItem('mamacos-ptt-global-keycode')
      pushToTalkGlobalKeycodeRef.current = raw ? Number(raw) : null
    } catch {
      pushToTalkGlobalKeycodeRef.current = null
    }
  }
  const usingGlobalPTTRef = useRef(false)
  usingGlobalPTTRef.current =
    globalPushToTalkAvailable && pushToTalkGlobalKeycodeRef.current !== null && pushToTalkGlobalKeycodeRef.current !== undefined
  const pushToTalkActiveRef = useRef(false)

  function applyMicEnabledState(pttHeld: boolean) {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    if (mutedRef.current) {
      track.enabled = false
      return
    }
    if (pushToTalkEnabledRef.current) {
      track.enabled = pttHeld
      return
    }
    track.enabled = true
  }

  function setPushToTalkEnabled(enabled: boolean) {
    setPushToTalkEnabledState(enabled)
    try {
      localStorage.setItem('mamacos-ptt-enabled', String(enabled))
    } catch {
    }
    setPushToTalkActive(false)
    applyMicEnabledState(false)
  }

  function setPushToTalkKey(code: string) {
    setPushToTalkKeyState(code)
    try {
      localStorage.setItem('mamacos-ptt-key', code)
    } catch {
    }
  }

  async function captureGlobalPushToTalkKey(): Promise<string | null> {
    if (!window.electronAPI?.startPTTCapture) return null
    const result = await window.electronAPI.startPTTCapture()
    if (!result) return null
    pushToTalkGlobalKeycodeRef.current = result.keycode
    setPushToTalkGlobalKeyNameState(result.name)
    try {
      localStorage.setItem('mamacos-ptt-global-keycode', String(result.keycode))
      localStorage.setItem('mamacos-ptt-global-keyname', result.name)
    } catch {
    }
    window.electronAPI.setGlobalPTTKey?.(result.keycode)
    return result.name
  }

  useEffect(() => {
    if (!window.electronAPI?.isGlobalPTTAvailable) return
    window.electronAPI.isGlobalPTTAvailable().then((available) => {
      setGlobalPushToTalkAvailable(available)
      if (available && typeof pushToTalkGlobalKeycodeRef.current === 'number') {
        window.electronAPI?.setGlobalPTTKey?.(pushToTalkGlobalKeycodeRef.current)
      }
    }).catch(() => {
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onPTTState) return
    return window.electronAPI.onPTTState((active) => {
      if (!usingGlobalPTTRef.current) return
      setPushToTalkActive(active)
      applyMicEnabledState(active)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      e.preventDefault()
      if (e.repeat && pushToTalkActiveRef.current) return
      setPushToTalkActive(true)
      applyMicEnabledState(true)
    }
    function handleBlur() {
      if (usingGlobalPTTRef.current || !pushToTalkActiveRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [speaking, setSpeaking] = useState(false)

  const [masterVolume, setMasterVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-master-volume')
      const n = raw ? Number(raw) : 100
      return Number.isFinite(n) && n > 0 ? n : 100
    } catch {
      return 100
    }
  })
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-participant-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  const [soundboardVolume, setSoundboardVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-soundboard-volume')
      return raw ? Number(raw) : 70
    } catch {
      return 70
    }
  })

  function setMasterVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setMasterVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-master-volume', String(clamped))
    } catch {
    }
  }

  const [deafened, setDeafenedState] = useState(false)
  const deafenedRef = useRef(false)
  function setDeafened(value: boolean) {
    deafenedRef.current = value
    setDeafenedState(value)
  }
  const preDeafenWasMutedRef = useRef(false)
  function toggleDeafen() {
    if (deafenedRef.current) {
      playUndeafenSound()
      setDeafened(false)
      if (!preDeafenWasMutedRef.current && mutedRef.current) toggleMute({ silent: true })
    } else {
      playDeafenSound()
      preDeafenWasMutedRef.current = mutedRef.current
      setDeafened(true)
      if (!mutedRef.current) toggleMute({ silent: true })
    }
  }

  const soundboardVolumeRef = useRef(soundboardVolume)
  soundboardVolumeRef.current = soundboardVolume
  function setSoundboardVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setSoundboardVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-soundboard-volume', String(clamped))
    } catch {
    }
  }

  function getParticipantVolume(userId: string): number {
    return Math.min(100, participantVolumes[userId] ?? 100)
  }

  function setParticipantVolume(userId: string, volume: number) {
    const clamped = Math.round(Math.max(0, Math.min(100, volume)))
    setParticipantVolumes((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-participant-volumes', JSON.stringify(next))
      } catch {
      }
      return next
    })
  }

  const [screenShareVolumes, setScreenShareVolumesState] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-screenshare-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  function getScreenShareVolume(userId: string): number {
    return Math.min(100, screenShareVolumes[userId] ?? 60)
  }

  function setScreenShareVolume(userId: string, volume: number) {
    const clamped = Math.round(Math.max(0, Math.min(100, volume)))
    setScreenShareVolumesState((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-screenshare-volumes', JSON.stringify(next))
      } catch {
      }
      return next
    })
  }

  const userIdRef = useRef<string | null>(null)
  userIdRef.current = user?.id ?? null

  const connectedRef = useRef(false)
  const joinedAtRef = useRef(0)
  const presenceRef = useRef<RealtimeChannel | null>(null)
  const leaveTeardownRef = useRef<Promise<void> | null>(null)
  const roomRef = useRef<Room | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const micPublicationRef = useRef<LocalTrackPublication | null>(null)
  const cameraPublicationRef = useRef<LocalTrackPublication | null>(null)
  const screenVideoPublicationRef = useRef<LocalTrackPublication | null>(null)
  const screenAudioPublicationRef = useRef<LocalTrackPublication | null>(null)
  const screenAudioDenoiserRef = useRef<ScreenAudioDenoiser | null>(null)
  const screenAudioOutputTrackRef = useRef<MediaStreamTrack | null>(null)
  const rawMicTrackRef = useRef<MediaStreamTrack | null>(null)
  const noiseSuppressorRef = useRef<NoiseSuppressor | null>(null)
  const autoSensitivityRef = useRef(createAutoSensitivity())
  useEffect(() => {
    if (!window.electronAPI?.isElectron || !connectedChannelId) return
    const t = window.setTimeout(() => void probeHardwareEncoders(), 4000)
    return () => window.clearTimeout(t)
  }, [connectedChannelId])
  function resetAutoSensitivity() {
    autoSensitivityRef.current.reset()
  }
  const localSpeakingAudioContextRef = useRef<AudioContext | null>(null)
  const localSpeakingAnalyserRef = useRef<AnalyserNode | null>(null)
  const localSpeakingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const localSpeakingLastAboveRef = useRef(false)
  const LOCAL_SPEAKING_THRESHOLD = 12
  const LOCAL_SPEAKING_RELEASE_MS = 300
  const LOCAL_SPEAKING_POLL_MS = 60

  function teardownLocalSpeakingDetection() {
    if (localSpeakingIntervalRef.current !== null) {
      clearInterval(localSpeakingIntervalRef.current)
      localSpeakingIntervalRef.current = null
    }
    localSpeakingAnalyserRef.current = null
    if (localSpeakingAudioContextRef.current) {
      localSpeakingAudioContextRef.current.close().catch(() => {})
      localSpeakingAudioContextRef.current = null
    }
    localSpeakingLastAboveRef.current = false
  }

  function setupLocalSpeakingDetection(stream: MediaStream) {
    teardownLocalSpeakingDetection()
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) return
    try {
      const audioContext = new AudioContext()
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]))
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      localSpeakingAudioContextRef.current = audioContext
      localSpeakingAnalyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      let lastAboveAt = 0
      localSpeakingIntervalRef.current = setInterval(() => {
        if (mutedRef.current) {
          if (localSpeakingLastAboveRef.current) {
            localSpeakingLastAboveRef.current = false
            setSpeaking(false)
          }
          return
        }
        analyser.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]
        const avg = sum / data.length
        const now = Date.now()
        if (avg > LOCAL_SPEAKING_THRESHOLD) {
          lastAboveAt = now
          if (!localSpeakingLastAboveRef.current) {
            localSpeakingLastAboveRef.current = true
            setSpeaking(true)
          }
        } else if (localSpeakingLastAboveRef.current && now - lastAboveAt > LOCAL_SPEAKING_RELEASE_MS) {
          localSpeakingLastAboveRef.current = false
          setSpeaking(false)
        }
      }, LOCAL_SPEAKING_POLL_MS)
    } catch {
    }
  }
  const remoteTracksRef = useRef<Map<string, Map<Track.Source, MediaStreamTrack>>>(new Map())
  const combinedStreamsRef = useRef<
    Map<
      string,
      {
        camera: MediaStream | null
        screen: MediaStream | null
        micAudio: MediaStream | null
        screenAudio: MediaStream | null
        trackIds: string
      }
    >
  >(new Map())
  const gameShareWatchRef = useRef<(() => void) | null>(null)
  const foregroundWatchUnsubRef = useRef<(() => void) | null>(null)
  const placeholderTrackRef = useRef<MediaStreamTrack | null>(null)
  const realScreenVideoTrackRef = useRef<MediaStreamTrack | null>(null)
  const appAudioPlayerRef = useRef<PcmStreamPlayer | null>(null)
  const appAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  const appAudioUnsubsRef = useRef<Array<() => void>>([])
  const systemAudioTrackRef = useRef<MediaStreamTrack | null>(null)

  function stopAppAudioCapture() {
    appAudioUnsubsRef.current.forEach((unsub) => unsub())
    appAudioUnsubsRef.current = []
    window.electronAPI?.stopProcessAudioCapture?.().catch(() => {})
    appAudioPlayerRef.current?.close()
    appAudioPlayerRef.current = null
  }

  async function startAppAudioCapture(target: number | 'system-excluding-self'): Promise<MediaStreamTrack | null> {
    const excludeSelf = target === 'system-excluding-self'
    const pid = excludeSelf ? 0 : target
    logDebug(`startAppAudioCapture: iniciando ${excludeSelf ? 'áudio do sistema sem o próprio app' : `pra pid=${pid}`}`)
    const startFn = excludeSelf ? window.electronAPI?.startSystemAudioExcludingSelf : window.electronAPI?.startProcessAudioCapture
    if (!startFn) {
      logDebug('startAppAudioCapture: função de captura nativa não existe (fora do Electron / preload antigo?)')
      return null
    }
    try {
      const result = excludeSelf
        ? await window.electronAPI!.startSystemAudioExcludingSelf!()
        : await window.electronAPI!.startProcessAudioCapture(pid)
      if (!result?.ok) {
        logDebug(`startAppAudioCapture: IPC voltou ok=false — ${result?.error ?? '(sem mensagem)'}`)
        if (!excludeSelf) {
          setError(
            result?.error
              ? `Captura de áudio só deste app falhou: ${result.error}`
              : 'Não foi possível capturar o áudio só deste app.'
          )
        }
        return null
      }
      logDebug('startAppAudioCapture: IPC voltou ok=true, esperando confirmação (format/error)...')
    } catch (err) {
      logDebug(`startAppAudioCapture: IPC de captura nativa lançou exceção — ${String(err)}`)
      if (!excludeSelf) setError('Não foi possível capturar o áudio só deste app.')
      return null
    }
    const player = new PcmStreamPlayer()
    appAudioPlayerRef.current = player
    let confirmedOnce = false
    const confirmed = await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      const unsubFormat = window.electronAPI!.onProcessAudioFormat((format) => {
        logDebug(`startAppAudioCapture: process-audio:format recebido — ${JSON.stringify(format)}`)
        player.setFormat(format)
        confirmedOnce = true
        finish(true)
      })
      const unsubChunk = window.electronAPI!.onProcessAudioChunk((chunk) => player.push(chunk))
      const unsubError = window.electronAPI!.onProcessAudioError((message) => {
        logDebug(`startAppAudioCapture: process-audio:error recebido — ${message}`)
        if (!excludeSelf || confirmedOnce) setError(`Captura de áudio só deste app falhou: ${message}`)
        if (!confirmedOnce) {
          finish(false)
          return
        }
        const deadTrack = player.stream.getAudioTracks()[0] ?? null
        if (deadTrack) void recoverScreenShareAudioToSystem(deadTrack)
      })
      appAudioUnsubsRef.current = [unsubFormat, unsubChunk, unsubError]
      setTimeout(() => {
        if (!settled) {
          logDebug(
            `startAppAudioCapture: nem process-audio:format nem process-audio:error chegaram em ${APP_AUDIO_CONFIRM_TIMEOUT_MS}ms (${excludeSelf ? 'sistema sem o app' : `pid ${pid}`}) — caindo pro áudio de sistema.`
          )
        }
        finish(false)
      }, APP_AUDIO_CONFIRM_TIMEOUT_MS)
    })
    if (!confirmed) {
      stopAppAudioCapture()
      return null
    }
    return player.stream.getAudioTracks()[0] ?? null
  }

  async function captureSystemAudioTrack(): Promise<MediaStreamTrack | null> {
    if (!window.electronAPI) return null
    try {
      const constraints = {
        video: false,
        audio: {
          mandatory: { chromeMediaSource: 'desktop' },
        },
      } as unknown as MediaStreamConstraints
      logDebug('captureSystemAudioTrack: pedindo áudio de sistema (loopback)...')
      const audioStream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = audioStream.getAudioTracks()[0] ?? null
      logDebug(`captureSystemAudioTrack: ${track ? `ok (${track.label || track.id})` : 'nenhuma track de áudio'}`)
      if (track) {
        void track
          .applyConstraints({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
          })
          .catch(() => {
          })
      }
      return track
    } catch (err) {
      const name = err instanceof Error ? err.name : null
      const detail = err instanceof Error ? err.message : String(err)
      logDebug(`captureSystemAudioTrack falhou: ${detail}${name ? ` (${name})` : ''}`)
      return null
    }
  }

  async function captureSystemAudioWithoutCallEcho(): Promise<{ track: MediaStreamTrack; native: boolean } | null> {
    if (window.electronAPI?.platform === 'win32' && window.electronAPI.startSystemAudioExcludingSelf) {
      const nativeTrack = await startAppAudioCapture('system-excluding-self')
      if (nativeTrack) {
        logDebug('captureSystemAudioWithoutCallEcho: usando áudio do sistema SEM o próprio app (sem eco da call)')
        return { track: nativeTrack, native: true }
      }
      logDebug('captureSystemAudioWithoutCallEcho: modo "excluir o próprio app" indisponível — usando loopback do Chromium (a call pode vazar no áudio da transmissão)')
    }
    const loopback = await captureSystemAudioTrack()
    return loopback ? { track: loopback, native: false } : null
  }

  async function recoverScreenShareAudioToSystem(deadTrack: MediaStreamTrack) {
    if (!screenStreamRef.current || appAudioTrackRef.current !== deadTrack) return
    stopAppAudioCapture()
    appAudioTrackRef.current = null
    const systemAudioTrack = await captureSystemAudioTrack()
    if (!screenStreamRef.current) {
      systemAudioTrack?.stop()
      return
    }
    if (!systemAudioTrack) {
      setError(
        'A captura de áudio só deste app parou (o jogo/app foi fechado?) e não consegui recuperar com áudio de sistema — a transmissão continua sem som (o vídeo continua normal).'
      )
      teardownScreenAudioDenoiser()
      if (screenAudioPublicationRef.current?.track) {
        roomRef.current?.localParticipant.unpublishTrack(screenAudioPublicationRef.current.track)
      }
      screenAudioPublicationRef.current = null
      screenAudioOutputTrackRef.current = null
      return
    }
    systemAudioTrackRef.current = systemAudioTrack
    const prepared = await prepareScreenAudioForSending(systemAudioTrack)
    screenAudioOutputTrackRef.current = prepared.track
    if (screenAudioPublicationRef.current?.track) {
      await (screenAudioPublicationRef.current.track as LocalAudioTrack).replaceTrack(prepared.track, true)
    } else if (roomRef.current) {
      screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(
        prepared.track,
        SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS
      )
    }
    setError(
      'A captura de áudio só deste app parou (o jogo/app foi fechado?) — a transmissão passou a usar o áudio de todo o sistema automaticamente.'
    )
  }

  function createPlaceholderVideoTrack(): MediaStreamTrack {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#18181b'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#8b8b8f'
      ctx.font = 'bold 36px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Transmissão pausada', canvas.width / 2, canvas.height / 2 - 20)
      ctx.font = '22px sans-serif'
      ctx.fillText('(fora do jogo no momento)', canvas.width / 2, canvas.height / 2 + 24)
    }
    const [track] = canvas.captureStream(0).getVideoTracks()
    return track
  }

  async function applyNoiseSuppression(
    rawTrack: MediaStreamTrack,
    overrides?: { noiseSuppression?: boolean; micSensitivity?: number; micSensitivityMode?: 'auto' | 'manual' }
  ): Promise<MediaStreamTrack> {
    const oldRaw = rawMicTrackRef.current
    if (oldRaw && oldRaw !== rawTrack) oldRaw.stop()
    rawMicTrackRef.current = rawTrack

    const noiseSuppressionEnabled = overrides?.noiseSuppression ?? audioSettingsRef.current.noiseSuppression

    const mode = overrides?.micSensitivityMode ?? audioSettingsRef.current.micSensitivityMode
    const sensitivity = mode === 'auto' ? DEFAULT_MIC_SENSITIVITY : overrides?.micSensitivity ?? audioSettingsRef.current.micSensitivity

    try {
      const isNewSuppressor = !noiseSuppressorRef.current
      if (!noiseSuppressorRef.current) {
        noiseSuppressorRef.current = await createNoiseSuppressor()
      }
      if (isNewSuppressor) resetAutoSensitivity()
      const processed = noiseSuppressorRef.current.setInputTrack(rawTrack, sensitivity, { denoise: noiseSuppressionEnabled })
      if (mode === 'auto' && autoSensitivityRef.current.current !== null) {
        noiseSuppressorRef.current.setSensitivityDb(autoSensitivityRef.current.current)
      }
      return processed
    } catch (err) {
      console.error('[VoiceContext] Redutor de ruído (RNNoise) indisponível, seguindo sem ele:', err)
      noiseSuppressorRef.current = null
      return rawTrack
    }
  }

  async function prepareScreenAudioForSending(rawTrack: MediaStreamTrack): Promise<{ track: MediaStreamTrack; stream: MediaStream }> {
    if (!audioSettingsRef.current.screenAudioNoiseSuppression) {
      teardownScreenAudioDenoiser()
      return { track: rawTrack, stream: new MediaStream([rawTrack]) }
    }
    try {
      screenAudioDenoiserRef.current?.destroy()
      screenAudioDenoiserRef.current = await createScreenAudioDenoiser()
      const processed = screenAudioDenoiserRef.current.setInputTrack(rawTrack)
      return { track: processed, stream: new MediaStream([processed]) }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logDebug(`prepareScreenAudioForSending: redutor de ruído da transmissão indisponível, seguindo sem ele — ${detail}`)
      screenAudioDenoiserRef.current = null
      return { track: rawTrack, stream: new MediaStream([rawTrack]) }
    }
  }

  function teardownScreenAudioDenoiser() {
    screenAudioDenoiserRef.current?.destroy()
    screenAudioDenoiserRef.current = null
  }

  const activeSoundboardAudiosRef = useRef<Set<HTMLAudioElement>>(new Set())

  function playLocalSoundboardAudio(url: string) {
    if (!isAllowedSoundboardUrl(url)) {
      logDebug('playLocalSoundboardAudio: URL fora do bucket do soundboard recusada')
      return
    }
    if (activeSoundboardAudiosRef.current.size >= MAX_CONCURRENT_SOUNDBOARD) return
    try {
      const audio = new Audio(url)
      audio.volume = deafenedRef.current ? 0 : soundboardVolumeRef.current / 100
      const sinkId = audioSettingsRef.current.speakerId
      void applyOutput(audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }, sinkId)
      activeSoundboardAudiosRef.current.add(audio)
      const forget = () => {
        activeSoundboardAudiosRef.current.delete(audio)
        audio.removeAttribute('src')
        audio.load()
      }
      audio.addEventListener('ended', forget, { once: true })
      audio.addEventListener('error', forget, { once: true })
      audio.play().catch(() => {
        forget()
      })
    } catch {
    }
  }

  useEffect(() => {
    activeSoundboardAudiosRef.current.forEach((audio) => {
      audio.volume = deafened ? 0 : soundboardVolume / 100
    })
  }, [soundboardVolume, deafened])

  async function playSoundboardSound(sound: SoundboardSoundRef): Promise<{ error: string | null }> {
    const channelId = connectedChannelIdRef.current
    if (!channelId || !connectedRef.current) return { error: 'Entre num canal de voz primeiro.' }
    const url = soundboardUrlFor(sound.storage_path)
    if (!isAllowedSoundboardUrl(url)) return { error: 'Som inválido.' }
    const rpcAny = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
    const { error } = await rpcAny('play_soundboard_sound', { p_channel_id: channelId, p_sound_id: sound.id })
    if (error) return { error: error.message }
    playLocalSoundboardAudio(url)
    window.dispatchEvent(new CustomEvent('mv:soundboard-play', { detail: { userId: userIdRef.current, name: (sound as { name?: string }).name ?? null } }))
    return { error: null }
  }

  const connectedChannelIdRef = useRef<string | null>(null)
  connectedChannelIdRef.current = connectedChannelId
  useEffect(() => {
    if (!connectedChannelId || !connectedServerId) return
    const channelId = connectedChannelId
    const serverId = connectedServerId
    let cancelled = false
    let rt: RealtimeChannel | null = null
    void ensureRealtimeAuth().then(() => {
      if (cancelled) return
      rt = changesChannel(`soundboard_plays:${channelId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'soundboard_plays', filter: `channel_id=eq.${channelId}` },
          (payload) => {
            const row = payload.new as { sound_id?: unknown; played_by?: unknown; channel_id?: unknown }
            if (row.channel_id !== channelId || typeof row.sound_id !== 'string') return
            if (row.played_by === userIdRef.current) return
            void supabase
              .from('soundboard_sounds')
              .select('storage_path, server_id, name')
              .eq('id', row.sound_id)
              .maybeSingle()
              .then(({ data }) => {
                if (cancelled || !data || data.server_id !== serverId) return
                playLocalSoundboardAudio(soundboardUrlFor(data.storage_path))
                window.dispatchEvent(new CustomEvent('mv:soundboard-play', { detail: { userId: row.played_by, name: (data as { name?: string }).name ?? null } }))
              })
          }
        )
        .subscribe()
    })
    return () => {
      cancelled = true
      if (rt) void supabase.removeChannel(rt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedChannelId, connectedServerId])

  function applyStreamWatchingTo(publication: RemoteTrackPublication, participantId: string) {
    if (publication.source !== Track.Source.ScreenShare && publication.source !== Track.Source.ScreenShareAudio) return
    if (!publication.isSubscribed) return
    const view = getStreamView()
    const watching = !view.hidden.has(participantId)
    if (publication.isEnabled !== watching) publication.setEnabled(watching)
    if (watching && publication.source === Track.Source.ScreenShare) {
      publication.setVideoQuality(STREAM_QUALITY_TO_LIVEKIT[view.quality.get(participantId) ?? 'auto'])
    }
  }
  function applyStreamWatching() {
    const room = roomRef.current
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) applyStreamWatchingTo(pub, p.identity)
    }
  }
  useEffect(() => subscribeStreamView(applyStreamWatching), [])

  function recomputeParticipant(participantId: string) {
    const tracks = remoteTracksRef.current.get(participantId)
    if (!tracks) return
    const micTrack = tracks.get(Track.Source.Microphone) ?? null
    const cameraTrack = tracks.get(Track.Source.Camera) ?? null
    const screenVideoTrack = tracks.get(Track.Source.ScreenShare) ?? null
    const screenAudioTrack = tracks.get(Track.Source.ScreenShareAudio) ?? null

    const trackIds = `${micTrack?.id ?? ''}|${cameraTrack?.id ?? ''}|${screenVideoTrack?.id ?? ''}|${screenAudioTrack?.id ?? ''}`
    const cached = combinedStreamsRef.current.get(participantId)
    if (cached && cached.trackIds === trackIds) return

    const cameraTracks = [micTrack, cameraTrack].filter((t): t is MediaStreamTrack => Boolean(t))
    const camera = cameraTracks.length > 0 ? new MediaStream(cameraTracks) : null

    const screenTracks = [screenVideoTrack, screenAudioTrack].filter((t): t is MediaStreamTrack => Boolean(t))
    const screen = screenTracks.length > 0 ? new MediaStream(screenTracks) : null

    const reuseAudio = (prevStream: MediaStream | null | undefined, track: MediaStreamTrack | null) => {
      if (!track) return null
      if (prevStream && prevStream.getAudioTracks()[0] === track) return prevStream
      return new MediaStream([track])
    }
    const micAudio = reuseAudio(cached?.micAudio, micTrack)
    const screenAudio = reuseAudio(cached?.screenAudio, screenAudioTrack)

    combinedStreamsRef.current.set(participantId, { camera, screen, micAudio, screenAudio, trackIds })
    setParticipants((prev) => ({
      ...prev,
      [participantId]: {
        userId: participantId,
        speaking: prev[participantId]?.speaking ?? false,
        cameraStream: camera,
        screenStream: screen,
        micAudioStream: micAudio,
        screenAudioStream: screenAudio,
      },
    }))
  }

  function seedParticipants(ids: Iterable<string>, myId: string) {
    const list = [...ids].filter((id) => id && id !== myId)
    if (!list.length) return
    setParticipants((prev) => {
      let next = prev
      for (const id of list) {
        if (id in next) continue
        if (next === prev) next = { ...prev }
        next[id] = {
          userId: id,
          speaking: false,
          cameraStream: null,
          screenStream: null,
          micAudioStream: null,
          screenAudioStream: null,
        }
      }
      return next
    })
  }

  function setRemoteTrack(participantId: string, source: Track.Source, track: MediaStreamTrack | null) {
    if (!remoteTracksRef.current.has(participantId)) remoteTracksRef.current.set(participantId, new Map())
    const tracks = remoteTracksRef.current.get(participantId)!
    if (track) tracks.set(source, track)
    else tracks.delete(source)
    recomputeParticipant(participantId)
  }

  function applyMicSenderPriority() {
    const sender = (micPublicationRef.current?.track as LocalAudioTrack | undefined)?.sender
    if (!sender) return
    try {
      const params = sender.getParameters()
      params.encodings = params.encodings?.length ? params.encodings : [{}]
      if ('priority' in params.encodings[0]) {
        ;(params.encodings[0] as RTCRtpEncodingParameters & { priority?: string }).priority = 'high'
      }
      if ('networkPriority' in params.encodings[0]) {
        ;(params.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high'
      }
      sender.setParameters(params).catch(() => {})
    } catch {
    }
  }

  function mapConnectionQuality(quality: LiveKitConnectionQuality): VoiceConnectionQuality {
    switch (quality) {
      case LiveKitConnectionQuality.Excellent:
        return 'excellent'
      case LiveKitConnectionQuality.Good:
        return 'good'
      case LiveKitConnectionQuality.Poor:
        return 'poor'
      default:
        return 'lost'
    }
  }

  function attachRoomEvents(room: Room, myId: string) {
    const isCurrent = () => roomRef.current === room

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (!isCurrent() || participant.identity === myId) return
      seedParticipants([participant.identity], myId)
      playUserJoinSound()
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (!isCurrent()) return
      remoteTracksRef.current.delete(participant.identity)
      combinedStreamsRef.current.delete(participant.identity)
      setParticipants((prev) => {
        if (!(participant.identity in prev)) return prev
        const next = { ...prev }
        delete next[participant.identity]
        return next
      })
      setConnectionQuality((prev) => {
        if (!(participant.identity in prev)) return prev
        const next = { ...prev }
        delete next[participant.identity]
        return next
      })
      playUserLeaveSound()
    })

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isCurrent()) return
        console.debug(`[VoiceContext] TrackSubscribed de ${participant.identity}: source=${track.source}, kind=${track.kind}`)
        setRemoteTrack(participant.identity, track.source, track.mediaStreamTrack)
        if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
          applyStreamWatchingTo(_publication, participant.identity)
        }
      }
    )

    room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isCurrent()) return
        setRemoteTrack(participant.identity, publication.source, null)
      }
    )

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      if (!isCurrent()) return
      const speakingIds = new Set(speakers.map((s) => s.identity))
      setParticipants((prev) => {
        let changed = false
        const next: typeof prev = { ...prev }
        for (const id of Object.keys(next)) {
          const isSpeaking = speakingIds.has(id)
          if (next[id].speaking !== isSpeaking) {
            next[id] = { ...next[id], speaking: isSpeaking }
            changed = true
          }
        }
        return changed ? next : prev
      })
    })

    room.on(
      RoomEvent.ConnectionQualityChanged,
      (quality: LiveKitConnectionQuality, participant: Participant) => {
        if (!isCurrent()) return
        if (participant.identity === myId) {
          setLocalConnectionQuality(mapConnectionQuality(quality))
          return
        }
        setConnectionQuality((prev) => ({ ...prev, [participant.identity]: mapConnectionQuality(quality) }))
      }
    )

    room.on(RoomEvent.Reconnecting, () => {
      if (!isCurrent()) return
      logDebug('LiveKit: reconectando...')
      setReconnecting(true)
      setLocalConnectionQuality('lost')
    })
    room.on(RoomEvent.Reconnected, () => {
      if (!isCurrent()) return
      logDebug('LiveKit: reconectado')
      setReconnecting(false)
      setLocalConnectionQuality(mapConnectionQuality(room.localParticipant.connectionQuality))
      applyMicSenderPriority()
    })

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (!isCurrent() || !connectedRef.current) return
      logDebug(`LiveKit: desconectado pelo servidor/rede (motivo=${reason ?? 'desconhecido'})`)
      const message =
        reason === DisconnectReason.DUPLICATE_IDENTITY
          ? 'Você entrou nesse canal de voz em outro dispositivo/janela — esta conexão foi encerrada.'
          : reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'Você foi removido do canal de voz.'
            : reason === DisconnectReason.ROOM_DELETED
              ? 'O canal de voz foi encerrado.'
              : 'A conexão com o canal de voz caiu. Verifique sua internet e entre de novo.'
      leave()
      setError(message)
    })
  }

  const joinSeqRef = useRef(0)
  const joinInFlightRef = useRef(false)

  const join = useCallback(async (channelId: string, serverId: string | null, options?: { displayName?: string; userLimit?: number }) => {
    if (!user || connectedRef.current || joinInFlightRef.current) return
    joinInFlightRef.current = true
    const seq = ++joinSeqRef.current
    const isStale = () => joinSeqRef.current !== seq
    let abandoned = false
    const assertActive = () => {
      if (isStale() || abandoned) throw new JoinAbortedError()
    }

    setJoiningChannelId(channelId)
    setConnecting(true)
    setError(null)
    setParticipants({})
    setConnectionQuality({})
    remoteTracksRef.current.clear()
    combinedStreamsRef.current.clear()
    joinedAtRef.current = Date.now()

    type MicResult = {
      stream: MediaStream
      raw: MediaStreamTrack
      processed: MediaStreamTrack
      suppressor: NoiseSuppressor | null
      usedFallback: boolean
    }
    const presence: { channel: RealtimeChannel | null } = { channel: null }
    let room: Room | null = null
    let micCommitted = false

    const micInner: Promise<MicResult> = (async () => {
      logDebug(`join(${channelId}): pedindo microfone...`)
      const { stream, usedFallback } = await getMicStreamWithFallback(audioSettingsRef.current.getAudioConstraints())
      const raw = stream.getAudioTracks()[0]
      let processed = raw
      let suppressor: NoiseSuppressor | null = null
      {
        try {
          suppressor = await createNoiseSuppressor()
          const mode = audioSettingsRef.current.micSensitivityMode
          processed = suppressor.setInputTrack(raw, mode === 'auto' ? DEFAULT_MIC_SENSITIVITY : audioSettingsRef.current.micSensitivity, {
            denoise: audioSettingsRef.current.noiseSuppression,
          })
        } catch (err) {
          console.error('[VoiceContext] Redutor de ruído (RNNoise) indisponível, seguindo sem ele:', err)
          suppressor?.destroy()
          suppressor = null
          processed = raw
        }
      }
      if (processed !== raw) {
        stream.removeTrack(raw)
        stream.addTrack(processed)
      }
      logDebug(`join(${channelId}): microfone pronto.`)
      return { stream, raw, processed, suppressor, usedFallback }
    })()
    const disposeMic = (mic: MicResult) => {
      mic.stream.getTracks().forEach((t) => t.stop())
      mic.raw.stop()
      mic.suppressor?.destroy()
      if (rawMicTrackRef.current === mic.raw) rawMicTrackRef.current = null
      if (noiseSuppressorRef.current === mic.suppressor) noiseSuppressorRef.current = null
      if (localStreamRef.current === mic.stream) {
        localStreamRef.current = null
        teardownLocalSpeakingDetection()
      }
    }

    try {
      if (leaveTeardownRef.current) await leaveTeardownRef.current
      assertActive()

      const channelInfoPromise = (async () => {
        if (serverId) {
          const { data: channelRow, error: channelErr } = await supabase
            .from('channels')
            .select('user_limit, name')
            .eq('id', channelId)
            .single()
          if (channelErr || !channelRow) {
            throw new Error('Você não tem mais acesso a esse canal de voz.')
          }
          if (!isStale()) setConnectedChannelName(channelRow.name ?? null)
          return { userLimit: channelRow.user_limit ?? 0 }
        }
        if (!isStale()) setConnectedChannelName(options?.displayName ?? null)
        return { userLimit: options?.userLimit ?? 0 }
      })()

      const micPromise = withTimeout(micInner, 20_000, 'acesso ao microfone')

      const topic = `voice:${channelId}`
      logDebug(`join(${channelId}): inscrevendo no canal de presença...`)
      const presencePromise = withTimeout(
        (async () => {
          const existingChannel = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
          if (existingChannel && existingChannel.state !== 'closed') {
            logDebug(`join(${channelId}): removendo canal de presença duplicado (estado anterior: ${existingChannel.state})...`)
            await supabase.removeChannel(existingChannel)
          }
          assertActive()
          await ensureRealtimeAuth()
          assertActive()
          const rt = supabase.channel(topic, privateChannelParams({ config: { presence: { key: user.id } } }))
          presence.channel = rt

          let myRoomStart = joinedAtRef.current
          rt.on('presence', { event: 'sync' }, () => {
            if (isStale()) return
            const state = rt.presenceState() as Record<string, { room_started_at?: number; joined_at?: number }[]>
            let min = myRoomStart
            for (const [key, metas] of Object.entries(state)) {
              if (key.startsWith('observer-')) continue
              for (const m of metas) {
                const t = Number(m.room_started_at ?? m.joined_at)
                if (Number.isFinite(t) && t > 0 && t < min) min = t
              }
            }
            if (min < myRoomStart) {
              myRoomStart = min
              void rt.track({ user_id: user.id, joined_at: joinedAtRef.current, room_started_at: myRoomStart }).catch(() => {})
            }
            setRoomStartedAt(myRoomStart)
          })

          await new Promise<void>((resolve, reject) => {
            rt.subscribe((status) => {
              logDebug(`join(${channelId}): status do canal de presença = ${status}`)
              if (status === 'SUBSCRIBED') {
                rt.track({ user_id: user.id, joined_at: joinedAtRef.current, room_started_at: myRoomStart })
                  .then(() => {
                    logDebug(`join(${channelId}): presença anunciada.`)
                    resolve()
                  })
                  .catch(reject)
              }
              if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                reject(new Error('Falha ao conectar ao canal de voz.'))
              }
            })
          })
        })(),
        15_000,
        'canal de presença'
      )

      logDebug(`join(${channelId}): pedindo token do LiveKit...`)
      const tokenPromise = withTimeout(
        takeLiveKitToken(channelId, serverId ? 0 : (options?.userLimit ?? 0)),
        15_000,
        'pedido de token do LiveKit'
      )

      const preparedRoom = createVoiceRoom()
      const preparePromise = tokenPromise
        .then((tok) => {
          rememberLiveKitUrl(tok.url)
          return preparedRoom.prepareConnection(tok.url, tok.token)
        })
        .catch(() => {})

      presencePromise.catch((err) => {
        logDebug(`join(${channelId}): presença falhou (a call segue) — ${err instanceof Error ? err.message : String(err)}`)
      })
      const [, tokenResult] = await Promise.all([channelInfoPromise, tokenPromise])
      assertActive()
      logDebug(`join(${channelId}): mic + presença + token todos prontos, conectando na sala LiveKit (${tokenResult.url})...`)

      room = preparedRoom
      await Promise.race([preparePromise, new Promise((resolve) => setTimeout(resolve, 300))])
      assertActive()
      roomRef.current = room
      attachRoomEvents(room, user.id)
      await withTimeout(room.connect(tokenResult.url, tokenResult.token), 15_000, 'conexão com o servidor de voz')
      assertActive()
      setActiveVoiceRoom(room)
      seedParticipants(room.remoteParticipants.keys(), user.id)
      const mic = await micPromise
      assertActive()

      micCommitted = true
      localStreamRef.current = mic.stream
      rawMicTrackRef.current = mic.raw
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = mic.suppressor
      resetAutoSensitivity()
      watchRawMicTrack(mic.raw)
      if (presence.channel) presenceRef.current = presence.channel
      else
        void presencePromise.then(
          () => {
            if (!presence.channel) return
            if (isStale() || abandoned) {
              void supabase.removeChannel(presence.channel).catch(() => {})
            } else {
              presenceRef.current = presence.channel
            }
          },
          () => {}
        )

      const allowedToPublish = tokenResult.canPublish && room.localParticipant.permissions?.canPublish !== false
      setCanPublish(allowedToPublish)
      if (allowedToPublish) {
        logDebug(`join(${channelId}): conectado na sala LiveKit, publicando microfone...`)
        setupLocalSpeakingDetection(mic.stream)
        micPublicationRef.current = await withTimeout(
          room.localParticipant.publishTrack(mic.processed, {
            name: 'microphone',
            source: Track.Source.Microphone,
            audioPreset: { maxBitrate: MIC_MAX_BITRATE },
          }),
          15_000,
          'publicação do microfone'
        )
        assertActive()
        applyMicEnabledState(pushToTalkActiveRef.current)
        if (mutedRef.current) {
          ;(micPublicationRef.current?.track as LocalAudioTrack | undefined)?.mute().catch(() => {})
        }
        applyMicSenderPriority()
      } else {
        logDebug(`join(${channelId}): conectado como OUVINTE (sem permissão de publicar).`)
        disposeMic(mic)
        localStreamRef.current = new MediaStream()
        mutedRef.current = true
        setMuted(true)
      }
      logDebug(`join(${channelId}): entrada concluída.`)

      connectedRef.current = true
      setConnectedChannelId(channelId)
      setConnectedServerId(serverId)
      setConnectedAt(Date.now())
      setReconnecting(false)
      if (mic.usedFallback && allowedToPublish) {
        setError('O microfone escolhido nas configurações não está disponível — usando o microfone padrão do sistema.')
      }
      playConnectSound()
    } catch (err) {
      abandoned = true
      const aborted = err instanceof JoinAbortedError || isStale()
      const isRoomFull = err instanceof Error && err.name === 'RoomFullError'
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      logDebug(`join(${channelId}): ${aborted ? 'cancelado' : 'falhou'} — ${detail}`)
      if (!aborted) {
        setError(
          isRoomFull
            ? 'Esse canal de voz já está cheio.'
            : (describeMicError(err) ??
                (err instanceof Error && err.message ? err.message : 'Não foi possível entrar no canal de voz.'))
        )
      }
      if (room) {
        if (roomRef.current === room) {
          roomRef.current = null
          micPublicationRef.current = null
          setActiveVoiceRoom(null)
        }
        void room.disconnect()
      }
      if (presence.channel) {
        const channelToRemove = presence.channel
        if (presenceRef.current === channelToRemove) presenceRef.current = null
        void supabase.removeChannel(channelToRemove).catch(() => {})
      }
      micInner.then(disposeMic, () => {})
      if (micCommitted && !isStale()) {
        localStreamRef.current?.getTracks().forEach((t) => t.stop())
        localStreamRef.current = null
        teardownLocalSpeakingDetection()
        setCanPublish(true)
      }
      if (!aborted) {
        mutedRef.current = false
        setMuted(false)
      }
    } finally {
      if (!isStale()) {
        joinInFlightRef.current = false
        setConnecting(false)
        setJoiningChannelId(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const leave = useCallback(() => {
    const wasConnected = connectedRef.current
    joinSeqRef.current++
    joinInFlightRef.current = false
    if (screenStreamRef.current || appAudioPlayerRef.current || systemAudioTrackRef.current) {
      stopScreenShareState()
    }
    screenShareOpRef.current = false
    setScreenShareConnecting(false)
    if (roomRef.current) {
      const roomToClose = roomRef.current
      roomRef.current = null
      setActiveVoiceRoom(null)
      void roomToClose.disconnect().finally(() => roomToClose.removeAllListeners())
    }
    micPublicationRef.current = null
    cameraPublicationRef.current = null
    screenVideoPublicationRef.current = null
    screenAudioPublicationRef.current = null
    remoteTracksRef.current.clear()
    combinedStreamsRef.current.clear()
    teardownLocalSpeakingDetection()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    rawMicTrackRef.current?.stop()
    rawMicTrackRef.current = null
    noiseSuppressorRef.current?.destroy()
    noiseSuppressorRef.current = null
    resetAutoSensitivity()
    gameShareWatchRef.current?.()
    gameShareWatchRef.current = null
    setLocalScreenStream(null)
    if (presenceRef.current) {
      const channelToLeave = presenceRef.current
      const teardown = (async () => {
        try {
          await channelToLeave.untrack()
        } catch {
        }
        try {
          await supabase.removeChannel(channelToLeave)
        } catch {
        }
      })()
      leaveTeardownRef.current = teardown
      teardown.finally(() => {
        if (leaveTeardownRef.current === teardown) leaveTeardownRef.current = null
      })
      presenceRef.current = null
    }
    setParticipants({})
    setConnectionQuality({})
    setLocalConnectionQuality(null)
    setReconnecting(false)
    setCanPublish(true)
    connectedRef.current = false
    setConnectedChannelId(null)
    setConnectedChannelName(null)
    setConnectedServerId(null)
    setConnectedAt(null)
    setRoomStartedAt(null)
    setConnecting(false)
    setJoiningChannelId(null)
    setVideoEnabled(false)
    setLocalCameraStream(null)
    setScreenSharing(false)
    setSpeaking(false)
    setPushToTalkActive(false)
    if (wasConnected) playDisconnectSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (connectedRef.current || joinInFlightRef.current) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!connectedRef.current) return
      if (audioSettingsRef.current.micSensitivityMode !== 'auto') return
      const suppressor = noiseSuppressorRef.current
      if (!suppressor) return
      const level = suppressor.sampleLevelDb()
      if (level === null) return

      const threshold = autoSensitivityRef.current.push(level)
      if (threshold !== null) suppressor.setSensitivityDb(threshold)
    }, AUTO_SENSITIVITY_TICK_MS)
    return () => clearInterval(interval)
  }, [])

  const afkConfigRef = useRef<{ channelId: string | null; timeoutMinutes: number } | null>(null)
  const lastActivityRef = useRef(Date.now())

  const afkForcedMuteRef = useRef<{ wasMuted: boolean } | null>(null)
  const enforceAfkMute = useCallback(() => {
    const afkId = afkConfigRef.current?.channelId
    const inAfk = Boolean(afkId && connectedChannelIdRef.current === afkId)
    if (inAfk) {
      if (!afkForcedMuteRef.current) afkForcedMuteRef.current = { wasMuted: mutedRef.current }
      if (!mutedRef.current) toggleMuteRef.current?.({ silent: true })
    } else if (afkForcedMuteRef.current && connectedChannelIdRef.current) {
      const { wasMuted } = afkForcedMuteRef.current
      afkForcedMuteRef.current = null
      if (!wasMuted && mutedRef.current) toggleMuteRef.current?.({ silent: true })
    }
  }, [])
  const toggleMuteRef = useRef<((opts?: { silent?: boolean }) => void) | null>(null)

  useEffect(() => {
    if (!connectedServerId) {
      afkConfigRef.current = null
      afkForcedMuteRef.current = null
      return
    }
    supabase
      .from('servers')
      .select('afk_channel_id, afk_timeout_minutes')
      .eq('id', connectedServerId)
      .single()
      .then(({ data }) => {
        afkConfigRef.current = data
          ? { channelId: data.afk_channel_id, timeoutMinutes: data.afk_timeout_minutes }
          : null
        enforceAfkMute()
      })
  }, [connectedServerId, enforceAfkMute])

  useEffect(() => {
    function markActive() {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('mousemove', markActive)
    window.addEventListener('mousedown', markActive)
    window.addEventListener('keydown', markActive)
    return () => {
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('mousedown', markActive)
      window.removeEventListener('keydown', markActive)
    }
  }, [])

  useEffect(() => {
    if (speaking) lastActivityRef.current = Date.now()
  }, [speaking])

  useEffect(() => {
    enforceAfkMute()
  }, [connectedChannelId, enforceAfkMute])

  const afkReturnRef = useRef<{ channelId: string; serverId: string; wasMuted: boolean } | null>(null)

  useEffect(() => {
    let busy = false
    const interval = setInterval(async () => {
      enforceAfkMute()
      const config = afkConfigRef.current
      if (busy || !connectedRef.current || !config?.channelId || !connectedChannelId || !connectedServerId) return
      let idleMs = Date.now() - lastActivityRef.current
      const systemIdleSec = await window.electronAPI?.getSystemIdleSeconds?.().catch(() => null)
      if (typeof systemIdleSec === 'number') idleMs = Math.min(idleMs, systemIdleSec * 1000)

      if (connectedChannelId === config.channelId) {
        const back = afkReturnRef.current
        if (back && back.serverId === connectedServerId && idleMs < 20_000) {
          busy = true
          afkReturnRef.current = null
          leave()
          setTimeout(() => {
            void join(back.channelId, back.serverId).then(() => {
              if (!back.wasMuted && mutedRef.current) toggleMute()
              busy = false
            }, () => {
              busy = false
            })
          }, 300)
        }
        return
      }
      if (idleMs >= config.timeoutMinutes * 60_000) {
        busy = true
        afkReturnRef.current = { channelId: connectedChannelId, serverId: connectedServerId, wasMuted: mutedRef.current }
        const afkChannelId = config.channelId
        const serverId = connectedServerId
        leave()
        setTimeout(() => {
          void join(afkChannelId, serverId).then(() => {
            if (!mutedRef.current) toggleMute()
            busy = false
          }, () => {
            busy = false
          })
        }, 300)
      }
    }, 15_000)
    return () => clearInterval(interval)
  }, [connectedChannelId, connectedServerId, leave, join, enforceAfkMute])

  const micOpChainRef = useRef<Promise<void>>(Promise.resolve())
  function runMicOp(op: () => Promise<void>): Promise<void> {
    const next = micOpChainRef.current.then(op, op)
    micOpChainRef.current = next.catch(() => {})
    return next
  }

  async function swapMicrophone(
    constraints: MediaTrackConstraints,
    nsOverrides?: { noiseSuppression?: boolean; micSensitivity?: number; micSensitivityMode?: 'auto' | 'manual' }
  ): Promise<{ usedFallback: boolean }> {
    const { stream: newStream, usedFallback } = await getMicStreamWithFallback(constraints, 1)
    const rawTrack = newStream.getAudioTracks()[0]
    if (!connectedRef.current || !canPublishRef.current || !localStreamRef.current) {
      newStream.getTracks().forEach((t) => t.stop())
      return { usedFallback }
    }
    const newTrack = await applyNoiseSuppression(rawTrack, nsOverrides)
    if (!connectedRef.current || !localStreamRef.current) {
      rawTrack.stop()
      newTrack.stop()
      if (rawMicTrackRef.current === rawTrack) rawMicTrackRef.current = null
      noiseSuppressorRef.current?.destroy()
      noiseSuppressorRef.current = null
      return { usedFallback }
    }
    watchRawMicTrack(rawTrack)

    const stream = localStreamRef.current
    const oldTrack = stream.getAudioTracks()[0]
    if (oldTrack && oldTrack !== newTrack) stream.removeTrack(oldTrack)
    if (!stream.getAudioTracks().includes(newTrack)) stream.addTrack(newTrack)
    setupLocalSpeakingDetection(stream)

    const micTrack = micPublicationRef.current?.track as LocalAudioTrack | undefined
    if (micTrack) await micTrack.replaceTrack(newTrack, true)
    if (oldTrack && oldTrack !== newTrack) oldTrack.stop()
    applyMicEnabledState(pushToTalkActiveRef.current)
    applyMicSenderPriority()
    return { usedFallback }
  }

  useEffect(() => {
    let checking = false
    const check = async () => {
      if (checking || !connectedRef.current || !canPublishRef.current) return
      const raw = rawMicTrackRef.current
      if (!raw || raw.readyState !== 'live') return
      checking = true
      try {
        const devices = await listDevices()
        if (!devices.length) return
        if (micNeedsSwap(devices, audioSettingsRef.current.micId, raw.getSettings())) {
          logDebug('microfone: dispositivo do sistema mudou (fone conectado/desconectado/Bluetooth) — trocando')
          await refreshAudioConstraints()
        }
      } finally {
        checking = false
      }
    }
    return onAudioDevicesSettled(() => void check())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function watchRawMicTrack(track: MediaStreamTrack) {
    track.addEventListener(
      'ended',
      () => {
        if (rawMicTrackRef.current !== track || !connectedRef.current) return
        logDebug('microfone encerrado pelo sistema (desplugado?) — tentando o microfone padrão')
        void runMicOp(async () => {
          if (rawMicTrackRef.current !== track || !connectedRef.current) return
          try {
            await swapMicrophone(audioSettingsRef.current.getAudioConstraints(''))
            setError('O microfone foi desconectado — passamos a usar o microfone padrão do sistema.')
          } catch (err) {
            logDebug(`recuperação do microfone falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
            setError('O microfone foi desconectado e nenhum outro microfone foi encontrado. Conecte um microfone e escolha-o nas configurações de voz.')
          }
        })
      },
      { once: true }
    )
  }

  async function changeMicrophone(deviceId: string) {
    audioSettingsRef.current.setMicId(deviceId || null)
    if (!connectedRef.current) return
    await runMicOp(async () => {
      if (!connectedRef.current) return
      try {
        const { usedFallback } = await swapMicrophone(audioSettingsRef.current.getAudioConstraints(deviceId))
        if (usedFallback) setError('O microfone escolhido não está disponível — usando o microfone padrão do sistema.')
      } catch (err) {
        logDebug(`changeMicrophone falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
        setError(describeMicError(err) ?? 'Não foi possível trocar de microfone.')
      }
    })
  }

  async function refreshAudioConstraints(
    overrides?: Partial<
      Pick<
        ReturnType<typeof useAudioSettings>,
        'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'micSensitivity' | 'micSensitivityMode'
      >
    >
  ) {
    if (!connectedRef.current) return
    const onlyGateChanged =
      overrides !== undefined &&
      Object.keys(overrides).length > 0 &&
      Object.keys(overrides).every((k) => k === 'micSensitivity' || k === 'micSensitivityMode')
    if (onlyGateChanged && noiseSuppressorRef.current) {
      const mode = overrides.micSensitivityMode ?? audioSettingsRef.current.micSensitivityMode
      if (mode === 'auto') {
        autoSensitivityRef.current.reset()
        noiseSuppressorRef.current.setSensitivity(DEFAULT_MIC_SENSITIVITY)
      } else {
        noiseSuppressorRef.current.setSensitivity(overrides.micSensitivity ?? audioSettingsRef.current.micSensitivity)
      }
      return
    }
    await runMicOp(async () => {
      if (!connectedRef.current) return
      try {
        await swapMicrophone(audioSettingsRef.current.getAudioConstraints(undefined, overrides), {
          noiseSuppression: overrides?.noiseSuppression,
          micSensitivity: overrides?.micSensitivity,
          micSensitivityMode: overrides?.micSensitivityMode,
        })
      } catch (err) {
        logDebug(`refreshAudioConstraints falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
      }
    })
  }

  toggleMuteRef.current = toggleMute
  function toggleMute(opts?: { silent?: boolean }) {
    if (deafenedRef.current && !opts?.silent) {
      playUndeafenSound()
      setDeafened(false)
      if (!mutedRef.current) return
    }
    const newMuted = !mutedRef.current
    const afkId = afkConfigRef.current?.channelId
    if (!newMuted && afkId && connectedChannelIdRef.current === afkId) {
      setError('Na sala AFK o microfone fica desligado. Entre em outra sala para falar.')
      return
    }
    if (!newMuted && !canPublishRef.current) {
      setError(NO_PUBLISH_PERMISSION_MESSAGE)
      return
    }
    mutedRef.current = newMuted
    setMuted(newMuted)
    applyMicEnabledState(pushToTalkActiveRef.current)
    const micTrack = micPublicationRef.current?.track as LocalAudioTrack | undefined
    if (micTrack) {
      if (newMuted) micTrack.mute().catch(() => {})
      else
        micTrack
          .unmute()
          .then(() => applyMicEnabledState(pushToTalkActiveRef.current))
          .catch(() => {})
    }
    if (!opts?.silent) {
      if (newMuted) playMuteSound()
      else playUnmuteSound()
    }
  }

  const cameraOpRef = useRef(false)
  async function toggleVideo() {
    if (cameraOpRef.current) return
    cameraOpRef.current = true
    try {
      await toggleVideoInner()
    } finally {
      cameraOpRef.current = false
    }
  }

  async function toggleVideoInner() {
    if (videoEnabled) {
      const track = localStreamRef.current?.getVideoTracks()[0]
      if (track) {
        if (cameraPublicationRef.current) {
          await roomRef.current?.localParticipant.unpublishTrack(track).catch(() => {})
          cameraPublicationRef.current = null
        }
        track.stop()
        localStreamRef.current?.removeTrack(track)
      }
      setVideoEnabled(false)
      setLocalCameraStream(null)
      return
    }
    if (!connectedRef.current) return
    if (!canPublishRef.current) {
      setError(NO_PUBLISH_PERMISSION_MESSAGE)
      return
    }
    let camTrack: MediaStreamTrack | null = null
    try {
      const cameraId = audioSettingsRef.current.cameraId
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      })
      const track = camStream.getVideoTracks()[0]
      camTrack = track
      if (!connectedRef.current || !roomRef.current || !localStreamRef.current) {
        track.stop()
        return
      }
      track.contentHint = 'motion'
      localStreamRef.current.addTrack(track)
      cameraPublicationRef.current = await roomRef.current.localParticipant.publishTrack(track, {
        name: 'camera',
        source: Track.Source.Camera,
        simulcast: true,
      })
      setVideoEnabled(true)
      setLocalCameraStream(new MediaStream([track]))
    } catch (err) {
      if (camTrack) {
        camTrack.stop()
        localStreamRef.current?.removeTrack(camTrack)
        cameraPublicationRef.current = null
      }
      const name = err instanceof Error ? err.name : String(err)
      const message = err instanceof Error ? err.message : ''
      logDebug(`toggleVideo: getUserMedia falhou (cameraId=${audioSettingsRef.current.cameraId ?? '(padrão)'}) — ${name}: ${message}`)
      const usingCustomCamera = Boolean(audioSettingsRef.current.cameraId)
      if ((name === 'OverconstrainedError' || name === 'NotFoundError') && usingCustomCamera) {
        setError(
          'A câmera escolhida nas Configurações não foi encontrada — se for uma câmera virtual (ex.: OBS), confirme que o programa está aberto e a câmera virtual está ativa.'
        )
      } else if (name === 'NotReadableError') {
        setError(
          usingCustomCamera
            ? 'Não foi possível abrir a câmera escolhida — ela pode estar sendo usada por outro programa, ou a captura de tela associada a ela (ex.: OBS) pode não estar realmente ativa no momento.'
            : 'Não foi possível abrir a câmera — ela pode estar sendo usada por outro programa no momento.'
        )
      } else if (name === 'NotAllowedError') {
        setError('Permissão de câmera negada. Habilite o acesso à câmera nas configurações do Windows/navegador e tente de novo.')
      } else {
        setError(`Não foi possível acessar a câmera${message ? `: ${message}` : '.'}`)
      }
    }
  }

  function stopScreenShareState() {
    setScreenSharePresetLabel(null)
    if (screenVideoPublicationRef.current) {
      playStreamStopSound()
      const publishedTrack = screenVideoPublicationRef.current.track
      if (publishedTrack) roomRef.current?.localParticipant.unpublishTrack(publishedTrack)
      screenVideoPublicationRef.current = null
    }
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    gameShareWatchRef.current?.()
    gameShareWatchRef.current = null
    window.electronAPI?.stopWatchProcessExit?.().catch(() => {})
    if (screenAudioPublicationRef.current) {
      const publishedTrack = screenAudioPublicationRef.current.track
      if (publishedTrack) roomRef.current?.localParticipant.unpublishTrack(publishedTrack)
      screenAudioPublicationRef.current = null
      screenAudioOutputTrackRef.current = null
    }
    teardownScreenAudioDenoiser()
    appAudioTrackRef.current = null
    stopAppAudioCapture()
    if (systemAudioTrackRef.current) {
      systemAudioTrackRef.current.stop()
      systemAudioTrackRef.current = null
    }
    screenStreamRef.current = null
    setLocalScreenStream(null)
    setScreenSharing(false)

    foregroundWatchUnsubRef.current?.()
    foregroundWatchUnsubRef.current = null
    window.electronAPI?.stopForegroundWatch?.().catch(() => {})
    realScreenVideoTrackRef.current = null
    if (placeholderTrackRef.current) {
      placeholderTrackRef.current.stop()
      placeholderTrackRef.current = null
    }
  }

  function startGameForegroundWatch(processNames: string[], forVideoTrack: MediaStreamTrack) {
    if (!window.electronAPI?.startForegroundWatch) return
    window.electronAPI
      .startForegroundWatch(processNames)
      .then((started) => {
        if (!started || !window.electronAPI) return
        if (realScreenVideoTrackRef.current !== forVideoTrack) {
          window.electronAPI.stopForegroundWatch?.().catch(() => {})
          return
        }
        foregroundWatchUnsubRef.current?.()
        foregroundWatchUnsubRef.current = window.electronAPI.onGameForegroundChanged((focused) => {
          const realTrack = realScreenVideoTrackRef.current
          const publishedTrack = screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined
          if (!realTrack || !publishedTrack) return
          if (focused) {
            publishedTrack.replaceTrack(realTrack, true).catch(() => {})
            if (placeholderTrackRef.current) {
              placeholderTrackRef.current.stop()
              placeholderTrackRef.current = null
            }
          } else {
            if (!placeholderTrackRef.current) placeholderTrackRef.current = createPlaceholderVideoTrack()
            publishedTrack.replaceTrack(placeholderTrackRef.current, true).catch(() => {})
          }
        })
      })
      .catch(() => {
      })
  }

  const screenShareOpRef = useRef(false)

  function effectiveScreenSharePreset(isGame: boolean): QualityPreset {
    const quality = localConnectionQualityRef.current
    return resolveScreenSharePreset(screenShareQualityRef.current, {
      isGame,
      gameAuto: screenShareGameAutoRef.current,
      weakNetwork: quality === 'poor' || quality === 'lost',
    })
  }

  function applyScreenSenderEncoding(track: LocalVideoTrack, preset: QualityPreset) {
    const sender = track.sender
    if (!sender) return
    try {
      const params = sender.getParameters()
      if (!params.encodings?.length) return
      const top = params.encodings.length - 1
      params.encodings.forEach((e, i) => {
        const enc = e as RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }
        if (i === top) {
          enc.maxBitrate = preset.maxBitrate
          enc.maxFramerate = preset.frameRate
        }
        if ('priority' in enc) enc.priority = 'high'
        if ('networkPriority' in enc) enc.networkPriority = 'high'
      })
      ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = preset.degradationPreference
      sender.setParameters(params).catch((err) => {
        logDebug(`applyScreenSenderEncoding: setParameters falhou — ${err instanceof Error ? err.message : String(err)}`)
      })
    } catch (err) {
      logDebug(`applyScreenSenderEncoding: falhou — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const getScreenShareStatsReport = useCallback(async (): Promise<RTCStatsReport | null> => {
    const sender = (screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined)?.sender
    if (!sender) return null
    try {
      return await sender.getStats()
    } catch {
      return null
    }
  }, [])

  async function watchForSoftwareEncoder(
    videoTrack: MediaStreamTrack,
    codec: ScreenCodec,
    buildOpts: (codec: ScreenCodec, allowSimulcast?: boolean) => Parameters<NonNullable<Room['localParticipant']>['publishTrack']>[1]
  ) {
    let current = codec
    let simulcastOn = Boolean((buildOpts(codec) as { simulcast?: boolean } | undefined)?.simulcast)
    let prev: OutboundVideoSample | null = null
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      if (screenStreamRef.current?.getVideoTracks()[0] !== videoTrack || videoTrack.readyState !== 'live') return
      const report = await getScreenShareStatsReport()
      const sample = pickOutboundVideo(report ? (Array.from(report.values()) as Record<string, unknown>[]) : null)
      if (!sample) continue
      const stats = prev ? computeScreenShareStats(prev, sample) : null
      prev = sample
      if (!stats || !stats.bitrateKbps || stats.hardwareEncoder === null) continue
      if (stats.hardwareEncoder) {
        logDebug(`transmissão: codificando pela placa de vídeo (${current}, ${sample.encoderImplementation ?? '?'})`)
        return
      }
      if (current !== 'h264' && current !== 'vp9' && current !== 'av1') return
      const room0 = roomRef.current
      if (simulcastOn && room0) {
        logDebug(`transmissão: ${current} com simulcast caiu no processador (${sample.encoderImplementation ?? '?'}) — tentando sem simulcast`)
        disableScreenSimulcast()
        simulcastOn = false
        try {
          await room0.localParticipant.unpublishTrack(videoTrack, false)
          if (screenStreamRef.current?.getVideoTracks()[0] !== videoTrack) return
          screenVideoPublicationRef.current = await room0.localParticipant.publishTrack(videoTrack, buildOpts(current, false))
          prev = null
        } catch (err) {
          logDebug(`transmissão: republicar sem simulcast falhou — ${err instanceof Error ? err.message : String(err)}`)
          return
        }
        continue
      }
      markCodecSoftwareOnly(current)
      resetHardwareProbe()
      const next = chooseScreenCodec(await probeHardwareEncoders(), true)
      logDebug(`transmissão: ${current} caiu no processador (${sample.encoderImplementation ?? '?'}) — próximo pela placa: ${next}`)
      const room = roomRef.current
      if (next === current || next === 'h264' || !room) return
      try {
        await room.localParticipant.unpublishTrack(videoTrack, false)
        if (screenStreamRef.current?.getVideoTracks()[0] !== videoTrack) return
        screenVideoPublicationRef.current = await room.localParticipant.publishTrack(videoTrack, buildOpts(next))
        current = next
        prev = null
      } catch (err) {
        logDebug(`transmissão: troca de formato falhou — ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    }
  }

  async function toggleScreenShare(opts?: { auto?: boolean }) {
    if (screenShareOpRef.current) return
    if (screenSharing) {
      stopScreenShareState()
      return
    }
    if (!connectedRef.current) return
    if (!canPublishRef.current) {
      setError(NO_PUBLISH_PERMISSION_MESSAGE)
      return
    }
    screenShareOpRef.current = true
    setScreenShareConnecting(true)
    let stream: MediaStream | null = null
    let started = false
    const callEnded = () => !connectedRef.current || !roomRef.current
    try {
      const captureInfo = { preset: screenShareQualityRef.current, isGame: false }
      stream = await captureScreenShareStream(screenShareQualityRef.current, opts, effectiveScreenSharePreset, captureInfo)
      const preset = captureInfo.preset
      const gameShareHint = takePendingGameShareHint()
      const appAudioChoice = takePendingAppAudioPid()
      const appAudioPid = appAudioChoice?.pid ?? null
      logDebug(`toggleScreenShare: appAudioChoice=${JSON.stringify(appAudioChoice)}`)
      if (callEnded()) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) throw new DOMException('A captura não retornou nenhum vídeo.', 'NotReadableError')
      const finalVideoSettings = await applyVideoQualityConstraints(videoTrack, preset, 'toggleScreenShare')
      let screenVideoCodec: ScreenCodec = pickScreenShareCodec(finalVideoSettings, 'toggleScreenShare')
      if (screenVideoCodec === 'h264') {
        const [hw, encodeSettings] = await Promise.all([
          Promise.race([
            probeHardwareEncoders(),
            new Promise<{ h264: boolean; vp9: boolean; av1: boolean }>((r) =>
              setTimeout(() => r({ h264: true, vp9: false, av1: false }), 1500)
            ),
          ]),
          window.electronAPI?.getVideoEncodeSettings?.().catch(() => null) ?? Promise.resolve(null),
        ])
        const preferGpu = encodeSettings ? encodeSettings.preferGpu : true
        screenVideoCodec = chooseScreenCodec(hw, preferGpu)
        logDebug(
          `toggleScreenShare: codificador de hardware — H264=${hw.h264} VP9=${hw.vp9} AV1=${hw.av1} (preferir GPU=${preferGpu}) → ${screenVideoCodec}`
        )
      }
      const simulcastLayers = screenSimulcastLayers(preset)
      const buildScreenVideoOpts = (codec: ScreenCodec, allowSimulcast = true) => {
        const simulcast = allowSimulcast && codec === 'h264' && simulcastLayers.length > 0 && screenSimulcastAllowed()
        return {
        name: 'screen',
        source: Track.Source.ScreenShare,
        videoCodec: codec,
        backupCodec: false,
        ...(codec === 'vp9' || codec === 'av1' ? { scalabilityMode: 'L1T3' as const } : {}),
        screenShareEncoding: {
          maxBitrate: preset.maxBitrate,
          maxFramerate: preset.frameRate,
          priority: 'high' as const,
        },
        degradationPreference: preset.degradationPreference,
        simulcast,
        ...(simulcast ? { screenShareSimulcastLayers: simulcastLayers } : {}),
        }
      }
      let audioTrack: MediaStreamTrack | null = stream.getAudioTracks()[0] ?? null
      if (!audioTrack && appAudioPid) {
        const appAudioTrack = await startAppAudioCapture(appAudioPid)
        if (appAudioTrack) {
          audioTrack = appAudioTrack
          appAudioTrackRef.current = appAudioTrack
        }
      }
      if (!audioTrack) {
        const systemAudio = await captureSystemAudioWithoutCallEcho()
        if (systemAudio) {
          audioTrack = systemAudio.track
          if (systemAudio.native) appAudioTrackRef.current = systemAudio.track
          else systemAudioTrackRef.current = systemAudio.track
        }
      }
      logDebug(`toggleScreenShare: resultado final do áudio — ${audioTrack ? `track ok (${audioTrack.label || audioTrack.id})` : 'NENHUMA track de áudio (transmissão vai muda)'}`)
      if (appAudioChoice?.isWindowChoice && !appAudioPid) {
        setError(
          audioTrack
            ? 'Não consegui identificar o processo do app/jogo — a transmissão vai com o áudio de todo o sistema em vez de só o dele (o vídeo continua normal).'
            : 'Não consegui identificar o processo do app/jogo, e também não consegui capturar o áudio de sistema — a transmissão vai sem áudio (o vídeo continua normal).'
        )
      }
      if (audioTrack) {
        const prepared = await prepareScreenAudioForSending(audioTrack)
        audioTrack = prepared.track
      } else {
        teardownScreenAudioDenoiser()
      }
      screenAudioOutputTrackRef.current = audioTrack
      if (callEnded() || screenStreamRef.current !== stream) {
        stopScreenShareState()
        return
      }
      videoTrack.contentHint = contentHintForPreset(preset)
      videoTrack.onended = () => {
        stopScreenShareState()
      }

      if (gameShareHint && window.electronAPI) {
        window.electronAPI.watchProcessExit?.(gameShareHint.processNames).catch(() => {})
        gameShareWatchRef.current = window.electronAPI.onWatchedProcessExited(() => {
          stopScreenShareState()
        })
      }

      realScreenVideoTrackRef.current = videoTrack
      if (roomRef.current) {
        logDebug(
          `toggleScreenShare: publicando vídeo (${screenVideoCodec}, até ${preset.maxBitrate}bps) e áudio (${audioTrack ? 'sim' : 'não'})...`
        )
        const [videoPublication, audioPublication] = await Promise.all([
          roomRef.current.localParticipant.publishTrack(videoTrack, buildScreenVideoOpts(screenVideoCodec)),
          audioTrack
            ? roomRef.current.localParticipant.publishTrack(audioTrack, SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS)
            : Promise.resolve(null),
        ])
        screenVideoPublicationRef.current = videoPublication
        if (audioPublication) screenAudioPublicationRef.current = audioPublication
        logDebug(`toggleScreenShare: publicação concluída (preset ${preset.label}${captureInfo.isGame ? ', fonte = jogo' : ''})`)
      }
      started = true
      setScreenSharing(true)
      if (window.electronAPI?.isElectron) void watchForSoftwareEncoder(videoTrack, screenVideoCodec, buildScreenVideoOpts)
      playStreamStartSound()
      setScreenSharePresetLabel(preset.label)

      if (gameShareHint) startGameForegroundWatch(gameShareHint.processNames, videoTrack)
      window.electronAPI?.focusAppWindow?.()
    } catch (err) {
      if (stream && !started) {
        if (screenStreamRef.current === stream) stopScreenShareState()
        else stream.getTracks().forEach((t) => t.stop())
      }
      if (err instanceof Error && err.name === 'NotAllowedError') return
      const name = err instanceof Error ? err.name : null
      const constraint =
        err && typeof err === 'object' && 'constraint' in err ? String((err as { constraint: unknown }).constraint) : null
      const detail = err instanceof Error ? err.message : String(err)
      const parts = [detail, name && name !== 'Error' ? `(${name}${constraint ? `: ${constraint}` : ''})` : null].filter(
        Boolean
      )
      const likelyExclusiveFullscreen = name === 'NotReadableError'
      const base = parts.length ? `Não foi possível compartilhar a tela: ${parts.join(' ')}` : 'Não foi possível compartilhar a tela.'
      setError(
        likelyExclusiveFullscreen
          ? `${base} — o jogo provavelmente está em modo de tela cheia EXCLUSIVA. Troque pra "tela cheia sem bordas" (borderless) nas configurações de vídeo do jogo e tente compartilhar de novo.`
          : base
      )
    } finally {
      screenShareOpRef.current = false
      setScreenShareConnecting(false)
    }
  }

  async function switchScreenShareSource() {
    if (!screenSharing || !screenStreamRef.current || screenShareOpRef.current) return
    screenShareOpRef.current = true
    setScreenShareConnecting(true)
    let newStream: MediaStream | null = null
    let adopted = false
    try {
      const captureInfo = { preset: screenShareQualityRef.current, isGame: false }
      newStream = await captureScreenShareStream(screenShareQualityRef.current, undefined, effectiveScreenSharePreset, captureInfo)
      const preset = captureInfo.preset
      if (!screenStreamRef.current || !connectedRef.current) {
        newStream.getTracks().forEach((t) => t.stop())
        return
      }
      const gameShareHint = takePendingGameShareHint()
      const appAudioChoice = takePendingAppAudioPid()
      const appAudioPid = appAudioChoice?.pid ?? null

      const newVideoTrack = newStream.getVideoTracks()[0]
      if (!newVideoTrack) {
        newStream.getTracks().forEach((t) => t.stop())
        return
      }
      const newVideoSettings = await applyVideoQualityConstraints(newVideoTrack, preset, 'switchScreenShareSource')
      if (exceedsH264FrameLimits(newVideoSettings.width, newVideoSettings.height)) {
        logDebug('switchScreenShareSource: ATENÇÃO — fonte nova acima do limite do H.264 e a redução não pegou')
      }
      let newAudioTrack: MediaStreamTrack | null = newStream.getAudioTracks()[0] ?? null
      newVideoTrack.contentHint = contentHintForPreset(preset)

      const oldVideoTrack = realScreenVideoTrackRef.current

      gameShareWatchRef.current?.()
      gameShareWatchRef.current = null
      window.electronAPI?.stopWatchProcessExit?.().catch(() => {})
      foregroundWatchUnsubRef.current?.()
      foregroundWatchUnsubRef.current = null
      window.electronAPI?.stopForegroundWatch?.().catch(() => {})
      if (placeholderTrackRef.current) {
        placeholderTrackRef.current.stop()
        placeholderTrackRef.current = null
      }
      stopAppAudioCapture()
      appAudioTrackRef.current = null
      systemAudioTrackRef.current?.stop()
      systemAudioTrackRef.current = null
      if (!newAudioTrack && appAudioPid) {
        const appAudioTrack = await startAppAudioCapture(appAudioPid)
        if (appAudioTrack) {
          newAudioTrack = appAudioTrack
          appAudioTrackRef.current = appAudioTrack
        }
      }
      if (!newAudioTrack) {
        const systemAudio = await captureSystemAudioWithoutCallEcho()
        if (systemAudio) {
          newAudioTrack = systemAudio.track
          if (systemAudio.native) appAudioTrackRef.current = systemAudio.track
          else systemAudioTrackRef.current = systemAudio.track
        }
      }
      if (appAudioChoice?.isWindowChoice && !appAudioPid) {
        setError(
          newAudioTrack
            ? 'Não consegui identificar o processo do app/jogo — a transmissão vai com o áudio de todo o sistema em vez de só o dele (o vídeo continua normal).'
            : 'Não consegui identificar o processo do app/jogo, e também não consegui capturar o áudio de sistema — a transmissão vai sem áudio (o vídeo continua normal).'
        )
      }

      if (newAudioTrack) {
        const prepared = await prepareScreenAudioForSending(newAudioTrack)
        newAudioTrack = prepared.track
      } else {
        teardownScreenAudioDenoiser()
      }

      const videoPublishedTrack = screenVideoPublicationRef.current?.track as LocalVideoTrack | undefined
      if (videoPublishedTrack) {
        await videoPublishedTrack.replaceTrack(newVideoTrack, true)
        applyScreenSenderEncoding(videoPublishedTrack, preset)
        setScreenSharePresetLabel(preset.label)
      }

      if (newAudioTrack && screenAudioPublicationRef.current?.track) {
        await (screenAudioPublicationRef.current.track as LocalAudioTrack).replaceTrack(newAudioTrack, true)
      } else if (newAudioTrack && !screenAudioPublicationRef.current && roomRef.current) {
        screenAudioPublicationRef.current = await roomRef.current.localParticipant.publishTrack(
          newAudioTrack,
          SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS
        )
      } else if (!newAudioTrack && screenAudioPublicationRef.current) {
        const oldAudioPublished = screenAudioPublicationRef.current.track
        if (oldAudioPublished) roomRef.current?.localParticipant.unpublishTrack(oldAudioPublished)
        screenAudioPublicationRef.current = null
      }

      if (oldVideoTrack) oldVideoTrack.onended = null
      screenStreamRef.current?.getTracks().forEach((t) => t.stop())

      adopted = true
      screenStreamRef.current = newStream
      setLocalScreenStream(newStream)
      realScreenVideoTrackRef.current = newVideoTrack
      screenAudioOutputTrackRef.current = newAudioTrack
      newVideoTrack.onended = () => {
        stopScreenShareState()
      }

      if (gameShareHint && window.electronAPI) {
        window.electronAPI.watchProcessExit?.(gameShareHint.processNames).catch(() => {})
        gameShareWatchRef.current = window.electronAPI.onWatchedProcessExited(() => {
          stopScreenShareState()
        })
      }
      if (gameShareHint) startGameForegroundWatch(gameShareHint.processNames, newVideoTrack)
      window.electronAPI?.focusAppWindow?.()
    } catch (err) {
      if (newStream && !adopted) newStream.getTracks().forEach((t) => t.stop())
      if (!(err instanceof Error && err.name === 'NotAllowedError')) {
        logDebug(`switchScreenShareSource falhou — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`)
        setError('Não foi possível trocar a fonte da transmissão — a transmissão anterior continua no ar.')
      }
    } finally {
      screenShareOpRef.current = false
      setScreenShareConnecting(false)
    }
  }

  const clearError = useCallback(() => setError(null), [])

  const splitValue = useSplitVoiceValue(
    {
        connectedChannelId,
        connectedChannelName,
        joiningChannelId,
        connectedAt,
        roomStartedAt,
        connectionQuality,
        localConnectionQuality,
        connectedServerId,
        connecting,
        reconnecting,
        canPublish,
        error,
        clearError,
        participants,
        muted,
        deafened,
        toggleDeafen,
        videoEnabled,
        localCameraStream,
        screenSharing,
        screenShareConnecting,
        localScreenStream,
        speaking,
        join,
        leave,
        toggleMute,
        pushToTalkEnabled,
        setPushToTalkEnabled,
        pushToTalkKey,
        setPushToTalkKey,
        pushToTalkActive,
        globalPushToTalkAvailable,
        pushToTalkGlobalKeyName,
        captureGlobalPushToTalkKey,
        toggleVideo,
        toggleScreenShare,
        switchScreenShareSource,
        screenSharePresetLabel,
        getScreenShareStatsReport,
        playSoundboardSound,
        changeMicrophone,
        refreshAudioConstraints,
        audioSettings,
        screenShareQuality,
        maxParticipants: MAX_PARTICIPANTS,
        masterVolume,
        setMasterVolume,
        soundboardVolume,
        setSoundboardVolume,
        getParticipantVolume,
        setParticipantVolume,
        getScreenShareVolume,
        setScreenShareVolume,
    },
    user?.id ?? null,
    `${JSON.stringify(participantVolumes)}|${JSON.stringify(screenShareVolumes)}`
  )

  return (
    <VoiceActivityContext.Provider value={splitValue.store}>
      <VoiceCoreContext.Provider value={splitValue.core}>
        <VoiceContext.Provider value={splitValue.full}>{children}</VoiceContext.Provider>
      </VoiceCoreContext.Provider>
    </VoiceActivityContext.Provider>
  )
}
