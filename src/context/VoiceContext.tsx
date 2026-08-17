import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
import { useScreenShareQuality } from '../hooks/useScreenShareQuality'
import {
  playConnectSound,
  playDisconnectSound,
  playMuteSound,
  playUnmuteSound,
  playUserJoinSound,
  playUserLeaveSound,
} from '../lib/sounds'

// Apenas STUN público está configurado neste ambiente. Um servidor TURN
// de verdade (coturn ou um serviço pago) precisa ser implantado à parte
// em produção — sem ele, peers atrás de NAT simétrico/restritivo podem
// não conseguir se conectar diretamente. Isso é uma limitação de
// infraestrutura, não do código de sinalização.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const MAX_PARTICIPANTS = 8

// No Windows, a PRIMEIRA chamada de getUserMedia às vezes esbarra numa
// corrida com a permissão de microfone do próprio sistema operacional
// (mais comum dentro do app desktop) — falha na primeira tentativa e
// funciona normalmente na segunda. Tentando de novo automaticamente
// aqui, a pessoa não precisa clicar duas vezes pra entrar na call.
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
const SPEAKING_THRESHOLD = 12

interface PeerState {
  pc: RTCPeerConnection
  makingOffer: boolean
  polite: boolean
}

export interface VoiceParticipant {
  userId: string
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  speaking: boolean
}

interface SignalPayload {
  from: string
  to: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

interface VoiceContextValue {
  connectedChannelId: string | null
  joiningChannelId: string | null
  connectedAt: number | null
  connectedServerId: string | null
  connecting: boolean
  error: string | null
  participants: Record<string, VoiceParticipant>
  muted: boolean
  videoEnabled: boolean
  screenSharing: boolean
  localScreenStream: MediaStream | null
  speaking: boolean
  join: (channelId: string, serverId: string) => Promise<void>
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
  toggleScreenShare: () => Promise<void>
  changeMicrophone: (deviceId: string) => Promise<void>
  refreshAudioConstraints: () => Promise<void>
  audioSettings: ReturnType<typeof useAudioSettings>
  screenShareQuality: ReturnType<typeof useScreenShareQuality>
  maxParticipants: number
  masterVolume: number
  setMasterVolume: (volume: number) => void
  getParticipantVolume: (userId: string) => number
  setParticipantVolume: (userId: string, volume: number) => void
  getScreenShareVolume: (userId: string) => number
  setScreenShareVolume: (userId: string, volume: number) => void
}

export const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

// Conexão de voz vive aqui, FORA da árvore de "qual canal estou vendo
// agora" — é por isso que trocar pra um canal de texto não te tira mais
// da chamada. Só a chamada explícita de leave() desconecta de verdade.
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const screenShareQuality = useScreenShareQuality()
  const screenShareQualityRef = useRef(screenShareQuality.preset)
  screenShareQualityRef.current = screenShareQuality.preset
  const audioSettingsRef = useRef(audioSettings)
  audioSettingsRef.current = audioSettings

  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null)
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null)
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null)
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)

  // Push-to-talk: quando ativado, o microfone fica DESLIGADO por
  // padrão e só liga enquanto a tecla escolhida está pressionada — bom
  // pra quem não quer vazar áudio de fundo (jogo, teclado mecânico,
  // etc.) sem precisar ficar mutando/desmutando manualmente toda hora.
  // Só funciona com o app em foco (ver aviso no README sobre a
  // limitação de não capturar tecla globalmente).
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
  const [pushToTalkActive, setPushToTalkActive] = useState(false)
  const pushToTalkEnabledRef = useRef(pushToTalkEnabled)
  pushToTalkEnabledRef.current = pushToTalkEnabled
  const pushToTalkKeyRef = useRef(pushToTalkKey)
  pushToTalkKeyRef.current = pushToTalkKey

  // Push-to-talk GLOBAL — funciona mesmo com o app fora de foco (tipo
  // com um jogo em tela cheia por cima). Só existe dentro do app
  // desktop, e só se o módulo nativo (uiohook-napi) tiver carregado
  // com sucesso naquele sistema especificamente — se não, cai
  // automaticamente pro modo antigo (só com o app em foco), sem
  // quebrar nada.
  const [globalPushToTalkAvailable, setGlobalPushToTalkAvailable] = useState(false)
  const [pushToTalkGlobalKeyName, setPushToTalkGlobalKeyNameState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('mamacos-ptt-global-keyname')
    } catch {
      return null
    }
  })
  const pushToTalkGlobalKeycodeRef = useRef<number | null>(null)
  try {
    const raw = localStorage.getItem('mamacos-ptt-global-keycode')
    pushToTalkGlobalKeycodeRef.current = raw ? Number(raw) : null
  } catch {
    pushToTalkGlobalKeycodeRef.current = null
  }
  const usingGlobalPTTRef = useRef(false)
  usingGlobalPTTRef.current = globalPushToTalkAvailable && pushToTalkGlobalKeycodeRef.current !== null

  // Combina mudo manual + push-to-talk numa única fonte de verdade pra
  // saber se a track de áudio deve estar transmitindo ou não.
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
      // best-effort
    }
    setPushToTalkActive(false)
    applyMicEnabledState(false)
  }

  function setPushToTalkKey(code: string) {
    setPushToTalkKeyState(code)
    try {
      localStorage.setItem('mamacos-ptt-key', code)
    } catch {
      // best-effort
    }
  }

  // Pede pro processo principal escutar a PRÓXIMA tecla pressionada em
  // qualquer lugar (mesmo com outro app em foco) e usa ela como a
  // tecla de push-to-talk global. Retorna null se a captura falhar,
  // expirar (10s sem apertar nada), ou se o modo global não estiver
  // disponível nesse sistema.
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
      // best-effort
    }
    window.electronAPI.setGlobalPTTKey?.(result.keycode)
    return result.name
  }

  useEffect(() => {
    if (!window.electronAPI?.isGlobalPTTAvailable) return
    window.electronAPI.isGlobalPTTAvailable().then((available) => {
      setGlobalPushToTalkAvailable(available)
      // Se já tinha uma tecla global configurada de uma sessão
      // anterior, reativa ela agora — o processo principal não guarda
      // isso sozinho entre reinícios do app.
      if (available && pushToTalkGlobalKeycodeRef.current !== null) {
        window.electronAPI?.setGlobalPTTKey?.(pushToTalkGlobalKeycodeRef.current)
      }
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
      // Se o modo global já está cuidando disso, o listener local não
      // faz nada — evita os dois mecanismos brigando entre si.
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      e.preventDefault()
      setPushToTalkActive(true)
      applyMicEnabledState(true)
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (usingGlobalPTTRef.current) return
      if (!pushToTalkEnabledRef.current || e.code !== pushToTalkKeyRef.current) return
      setPushToTalkActive(false)
      applyMicEnabledState(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [speaking, setSpeaking] = useState(false)

  const [masterVolume, setMasterVolumeState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('mamacos-master-volume')
      return raw ? Number(raw) : 100
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

  function setMasterVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setMasterVolumeState(clamped)
    try {
      localStorage.setItem('mamacos-master-volume', String(clamped))
    } catch {
      // best-effort
    }
  }

  function getParticipantVolume(userId: string): number {
    return participantVolumes[userId] ?? 100
  }

  function setParticipantVolume(userId: string, volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setParticipantVolumes((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-participant-volumes', JSON.stringify(next))
      } catch {
        // best-effort
      }
      return next
    })
  }

  // Volume separado pro ÁUDIO da transmissão de tela de cada pessoa
  // (som do jogo dela), independente do volume da voz/microfone dela —
  // dá pra abaixar o jogo de alguém sem mutar a voz da pessoa, e vice-versa.
  const [screenShareVolumes, setScreenShareVolumesState] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('mamacos-screenshare-volumes')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  function getScreenShareVolume(userId: string): number {
    return screenShareVolumes[userId] ?? 100
  }

  function setScreenShareVolume(userId: string, volume: number) {
    const clamped = Math.max(0, Math.min(100, volume))
    setScreenShareVolumesState((prev) => {
      const next = { ...prev, [userId]: clamped }
      try {
        localStorage.setItem('mamacos-screenshare-volumes', JSON.stringify(next))
      } catch {
        // best-effort
      }
      return next
    })
  }

  const userIdRef = useRef<string | null>(null)
  userIdRef.current = user?.id ?? null

  const connectedRef = useRef(false)
  const hasSyncedRef = useRef(false)
  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const peersRef = useRef<Map<string, PeerState>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map())
  // Cada peer pode mandar mais de uma MediaStream (mic/câmera + tela).
  // Em vez de adivinhar qual é qual pela ordem de chegada (frágil e foi
  // a causa do compartilhamento de tela não aparecer pros outros),
  // guardamos toda stream recebida aqui e usamos o mapeamento explícito
  // vindo do broadcast 'screen-meta' pra saber qual stream.id é a tela.
  const rawStreamsRef = useRef<Map<string, Map<string, MediaStream>>>(new Map())
  const screenStreamIdsRef = useRef<Map<string, string>>(new Map())

  function ensureAudioContext() {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext()
    return audioContextRef.current
  }

  function setupAnalyser(key: string, stream: MediaStream) {
    if (stream.getAudioTracks().length === 0) return
    try {
      const ctx = ensureAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analysersRef.current.set(key, analyser)
    } catch {
      // getUserMedia/AudioContext podem falhar em navegadores sem suporte — degrada graciosamente
    }
  }

  function sendSignal(to: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({ type: 'broadcast', event: 'rtc', payload: { from, to, ...data } })
  }

  // Avisa todo mundo no canal (broadcast, não é dirigido a um peer
  // específico) qual é o stream.id da MINHA tela compartilhada agora —
  // ou null quando paro. É esse aviso explícito que os outros usam pra
  // saber, com certeza, qual das minhas streams é a tela.
  function broadcastScreenMeta(screenStreamId: string | null) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({ type: 'broadcast', event: 'screen-meta', payload: { from, screenStreamId } })
  }

  // Recalcula cameraStream/screenStream de um peer a partir de TODAS as
  // streams já recebidas dele + o mapeamento de qual stream.id é tela
  // (vindo do broadcast). Funciona não importa a ordem de chegada.
  function recomputeParticipant(peerId: string) {
    const streams = rawStreamsRef.current.get(peerId)
    if (!streams || streams.size === 0) return
    const screenId = screenStreamIdsRef.current.get(peerId)
    let cameraStream: MediaStream | null = null
    let screenStream: MediaStream | null = null
    streams.forEach((s, id) => {
      if (screenId && id === screenId) screenStream = s
      else if (!cameraStream) cameraStream = s
    })
    setParticipants((prev) => ({
      ...prev,
      [peerId]: {
        userId: peerId,
        speaking: prev[peerId]?.speaking ?? false,
        cameraStream,
        screenStream,
      },
    }))
  }

  function createPeerConnection(peerId: string, polite: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peerState: PeerState = { pc, makingOffer: false, polite }
    peersRef.current.set(peerId, peerState)

    localStreamRef.current?.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, localStreamRef.current!)
      if (track.kind === 'audio') {
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        // O padrão do Opus fica bem baixo (~32kbps) — subindo pra
        // 64kbps a voz fica bem mais nítida, por um custo de banda
        // irrelevante (poucos KB/s a mais).
        params.encodings[0].maxBitrate = 64_000
        sender.setParameters(params).catch(() => {})
      }
    })
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, screenStreamRef.current!)
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        params.encodings[0].maxBitrate = 4_000_000
        ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-framerate'
        sender.setParameters(params).catch(() => {})
      })
    }

    pc.onnegotiationneeded = async () => {
      try {
        peerState.makingOffer = true
        await pc.setLocalDescription()
        if (pc.localDescription) sendSignal(peerId, { description: pc.localDescription })
      } catch (err) {
        console.error('Erro ao negociar conexão de voz:', err)
      } finally {
        peerState.makingOffer = false
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(peerId, { candidate: candidate.toJSON() })
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (!rawStreamsRef.current.has(peerId)) rawStreamsRef.current.set(peerId, new Map())
      rawStreamsRef.current.get(peerId)!.set(stream.id, stream)
      recomputeParticipant(peerId)
      if (!analysersRef.current.has(peerId)) setupAnalyser(peerId, stream)
    }

    return pc
  }

  function ensurePeer(peerId: string): boolean {
    if (peersRef.current.has(peerId) || !userIdRef.current) return false
    if (peersRef.current.size >= MAX_PARTICIPANTS - 1) return false
    createPeerConnection(peerId, userIdRef.current > peerId)
    return true
  }

  const handleSignal = useCallback(async (payload: SignalPayload) => {
    const myId = userIdRef.current
    if (!myId || payload.to !== myId) return

    const peerId = payload.from
    if (!peersRef.current.has(peerId)) createPeerConnection(peerId, myId > peerId)
    const peerState = peersRef.current.get(peerId)
    if (!peerState) return
    const { pc, polite } = peerState

    try {
      if (payload.description) {
        const offerCollision =
          payload.description.type === 'offer' && (peerState.makingOffer || pc.signalingState !== 'stable')
        if (!polite && offerCollision) return

        await pc.setRemoteDescription(payload.description)
        if (payload.description.type === 'offer') {
          await pc.setLocalDescription()
          if (pc.localDescription) sendSignal(peerId, { description: pc.localDescription })
        }
      } else if (payload.candidate) {
        try {
          await pc.addIceCandidate(payload.candidate)
        } catch (err) {
          if (!polite) throw err
        }
      }
    } catch (err) {
      console.error('Erro de sinalização WebRTC:', err)
    }
  }, [])

  function cleanupPeer(peerId: string) {
    peersRef.current.get(peerId)?.pc.close()
    peersRef.current.delete(peerId)
    analysersRef.current.delete(peerId)
    rawStreamsRef.current.delete(peerId)
    screenStreamIdsRef.current.delete(peerId)
    setParticipants((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }

  const join = useCallback(async (channelId: string, serverId: string) => {
    if (!user || connectedRef.current) return
    // Avisa a UI (a lista de canais) IMEDIATAMENTE que estamos prestes a
    // entrar nesse canal, antes de qualquer trabalho assíncrono (pedir
    // microfone, etc.) — isso dá tempo do observador de presença na
    // barra lateral (useVoicePresence) se desinscrever do mesmo canal
    // Realtime ANTES da gente tentar se inscrever de verdade nele.
    // Sem isso, a primeira tentativa de entrar sempre colidia com essa
    // inscrição de observação já existente.
    setJoiningChannelId(channelId)
    setConnecting(true)
    setError(null)
    hasSyncedRef.current = false

    try {
      const stream = await getUserMediaWithRetry({ audio: audioSettingsRef.current.getAudioConstraints() })
      localStreamRef.current = stream
      mutedRef.current = false
      applyMicEnabledState(false)
      setupAnalyser('local', stream)

      const rt = supabase.channel(`voice:${channelId}`, {
        config: { broadcast: { self: false }, presence: { key: user.id } },
      })
      realtimeRef.current = rt

      rt.on('broadcast', { event: 'rtc' }, ({ payload }) => handleSignal(payload as SignalPayload))

      rt.on('broadcast', { event: 'screen-meta' }, ({ payload }) => {
        const { from, screenStreamId } = payload as { from: string; screenStreamId: string | null }
        if (screenStreamId) screenStreamIdsRef.current.set(from, screenStreamId)
        else screenStreamIdsRef.current.delete(from)
        recomputeParticipant(from)
      })

      rt.on('presence', { event: 'sync' }, () => {
        const state = rt.presenceState()
        const ids = Object.keys(state).filter((id) => id !== user.id)
        const isFirstSync = !hasSyncedRef.current
        let hasNewPeer = false

        ids.forEach((id) => {
          const wasNew = ensurePeer(id)
          if (wasNew) {
            hasNewPeer = true
            if (!isFirstSync) playUserJoinSound()
          }
        })
        Array.from(peersRef.current.keys()).forEach((id) => {
          if (!ids.includes(id)) {
            cleanupPeer(id)
            if (!isFirstSync) playUserLeaveSound()
          }
        })
        hasSyncedRef.current = true

        // Quem chega depois de eu já estar compartilhando tela perdeu o
        // aviso original (broadcast não guarda histórico) — reenvia
        // sempre que alguém novo aparece na sala.
        if (hasNewPeer && screenStreamRef.current) {
          broadcastScreenMeta(screenStreamRef.current.id)
        }
      })

      await new Promise<void>((resolve, reject) => {
        rt.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await rt.track({ user_id: user.id })
            resolve()
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error('Falha ao conectar ao canal de voz'))
          }
        })
      })

      connectedRef.current = true
      setConnectedChannelId(channelId)
      setConnectedServerId(serverId)
      setConnectedAt(Date.now())
      playConnectSound()
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permissão de microfone negada. Habilite o acesso ao microfone e tente de novo.'
          : 'Não foi possível entrar no canal de voz.'
      )
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current)
        realtimeRef.current = null
      }
    } finally {
      setConnecting(false)
      setJoiningChannelId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, handleSignal])

  const leave = useCallback(() => {
    const wasConnected = connectedRef.current
    peersRef.current.forEach((_, id) => cleanupPeer(id))
    peersRef.current.clear()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setLocalScreenStream(null)
    analysersRef.current.clear()
    if (realtimeRef.current) {
      realtimeRef.current.untrack()
      supabase.removeChannel(realtimeRef.current)
      realtimeRef.current = null
    }
    setParticipants({})
    connectedRef.current = false
    setConnectedChannelId(null)
    setConnectedServerId(null)
    setConnectedAt(null)
    setConnecting(false)
    setMuted(false)
    setVideoEnabled(false)
    setScreenSharing(false)
    setSpeaking(false)
    if (wasConnected) playDisconnectSound()
  }, [])

  // Só desconecta quando o Provider inteiro desmonta (ex: logout) —
  // NÃO reage a troca de canal/servidor visualizado, que é exatamente o
  // comportamento que corrige o bug de "sair da call ao trocar de tela".
  useEffect(() => {
    return () => {
      if (connectedRef.current) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Canal AFK: move automaticamente quem fica inativo -------------
  const afkConfigRef = useRef<{ channelId: string | null; timeoutMinutes: number } | null>(null)
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!connectedServerId) {
      afkConfigRef.current = null
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
      })
  }, [connectedServerId])

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
    const interval = setInterval(() => {
      const config = afkConfigRef.current
      if (!connectedRef.current || !config?.channelId || !connectedChannelId || !connectedServerId) return
      if (connectedChannelId === config.channelId) return // já está no canal AFK
      const idleMs = Date.now() - lastActivityRef.current
      if (idleMs >= config.timeoutMinutes * 60_000) {
        const afkChannelId = config.channelId
        const serverId = connectedServerId
        leave()
        setTimeout(() => join(afkChannelId, serverId), 300)
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [connectedChannelId, connectedServerId, leave, join])

  async function changeMicrophone(deviceId: string) {
    audioSettingsRef.current.setMicId(deviceId)
    if (!connectedRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioSettingsRef.current.getAudioConstraints(deviceId),
      })
      const newTrack = newStream.getAudioTracks()[0]
      newTrack.enabled = !muted

      const oldTrack = localStreamRef.current?.getAudioTracks()[0]
      if (oldTrack) {
        oldTrack.stop()
        localStreamRef.current?.removeTrack(oldTrack)
      }
      localStreamRef.current?.addTrack(newTrack)

      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        sender?.replaceTrack(newTrack)
      })

      setupAnalyser('local', newStream)
    } catch {
      setError('Não foi possível trocar de microfone.')
    }
  }

  // Reaplica as configurações de áudio atuais (cancelamento de eco,
  // redução de ruído, ganho automático) no microfone já conectado —
  // usado pelo botão de liga/desliga redutor de ruído ao lado do perfil,
  // pra a mudança valer na call em andamento sem precisar reconectar.
  async function refreshAudioConstraints() {
    if (!connectedRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioSettingsRef.current.getAudioConstraints(),
      })
      const newTrack = newStream.getAudioTracks()[0]
      newTrack.enabled = !muted

      const oldTrack = localStreamRef.current?.getAudioTracks()[0]
      if (oldTrack) {
        oldTrack.stop()
        localStreamRef.current?.removeTrack(oldTrack)
      }
      localStreamRef.current?.addTrack(newTrack)

      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        sender?.replaceTrack(newTrack)
      })

      setupAnalyser('local', newStream)
    } catch {
      // se falhar, o microfone atual continua funcionando com as configs antigas
    }
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const newMuted = !muted
    mutedRef.current = newMuted
    setMuted(newMuted)
    applyMicEnabledState(pushToTalkActive)
    if (newMuted) playMuteSound()
    else playUnmuteSound()
  }

  async function toggleVideo() {
    if (videoEnabled) {
      const track = localStreamRef.current?.getVideoTracks()[0]
      if (track) {
        track.stop()
        localStreamRef.current?.removeTrack(track)
        peersRef.current.forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track === track)
          if (sender) pc.removeTrack(sender)
        })
      }
      setVideoEnabled(false)
      return
    }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      const track = camStream.getVideoTracks()[0]
      localStreamRef.current?.addTrack(track)
      peersRef.current.forEach(({ pc }) => pc.addTrack(track, localStreamRef.current!))
      setVideoEnabled(true)
    } catch {
      setError('Não foi possível acessar a câmera.')
    }
  }

  async function toggleScreenShare() {
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach((track) => {
        track.stop()
        peersRef.current.forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track === track)
          if (sender) pc.removeTrack(sender)
        })
      })
      broadcastScreenMeta(null)
      screenStreamRef.current = null
      setLocalScreenStream(null)
      setScreenSharing(false)
      return
    }
    try {
      const preset = screenShareQualityRef.current
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Usa o preset de qualidade escolhido pela pessoa (Desempenho
          // ou Qualidade máxima) — em vez de um valor fixo, ela decide
          // o equilíbrio entre nitidez e não travar o jogo.
          width: { ideal: preset.width, max: preset.width },
          height: { ideal: preset.height, max: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        },
        // Inclui o áudio do sistema/jogo na transmissão, não só a
        // imagem — quem estiver assistindo ouve o som do jogo junto.
        audio: true,
      })
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      // Avisa a sala ANTES de adicionar a track — o broadcast chega quase
      // instantâneo, enquanto a renegociação WebRTC (oferta/resposta/ICE)
      // leva alguns round-trips, então o aviso quase sempre chega primeiro.
      broadcastScreenMeta(stream.id)
      const videoTrack = stream.getVideoTracks()[0]
      const audioTrack = stream.getAudioTracks()[0]
      // "motion" prioriza fluidez de movimento em vez de nitidez de
      // texto estático — melhor pra compartilhar jogo/vídeo do que a
      // opção padrão, que otimiza pra tela parada (documento, planilha)
      videoTrack.contentHint = 'motion'
      videoTrack.onended = () => {
        screenStreamRef.current = null
        setLocalScreenStream(null)
        setScreenSharing(false)
        broadcastScreenMeta(null)
      }
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.addTrack(videoTrack, stream)
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        params.encodings[0].maxBitrate = preset.maxBitrate
        ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
          preset.degradationPreference
        sender.setParameters(params).catch(() => {
          // alguns navegadores/drivers não suportam todos os campos — sem problema, segue com o padrão
        })
        if (audioTrack) pc.addTrack(audioTrack, stream)
      })
      setScreenSharing(true)
    } catch {
      setError('Não foi possível compartilhar a tela.')
    }
  }

  // Detecção de fala: amostra o nível de áudio de cada analyser a cada 200ms
  useEffect(() => {
    if (!connectedChannelId) return
    const buffer = new Uint8Array(256)
    const interval = setInterval(() => {
      analysersRef.current.forEach((analyser, key) => {
        analyser.getByteFrequencyData(buffer)
        const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length
        const isSpeaking = avg > SPEAKING_THRESHOLD
        if (key === 'local') {
          setSpeaking((prev) => (prev !== isSpeaking ? isSpeaking : prev))
        } else {
          setParticipants((prev) => {
            if (!prev[key] || prev[key].speaking === isSpeaking) return prev
            return { ...prev, [key]: { ...prev[key], speaking: isSpeaking } }
          })
        }
      })
    }, 200)
    return () => clearInterval(interval)
  }, [connectedChannelId])

  return (
    <VoiceContext.Provider
      value={{
        connectedChannelId,
        joiningChannelId,
        connectedAt,
        connectedServerId,
        connecting,
        error,
        participants,
        muted,
        videoEnabled,
        screenSharing,
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
        changeMicrophone,
        refreshAudioConstraints,
        audioSettings,
        screenShareQuality,
        maxParticipants: MAX_PARTICIPANTS,
        masterVolume,
        setMasterVolume,
        getParticipantVolume,
        setParticipantVolume,
        getScreenShareVolume,
        setScreenShareVolume,
      }}
    >
      {children}
    </VoiceContext.Provider>
  )
}
