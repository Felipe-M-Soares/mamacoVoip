import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useAudioSettings } from '../hooks/useAudioSettings'
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
  toggleVideo: () => Promise<void>
  toggleScreenShare: () => Promise<void>
  changeMicrophone: (deviceId: string) => Promise<void>
  refreshAudioConstraints: () => Promise<void>
  audioSettings: ReturnType<typeof useAudioSettings>
  maxParticipants: number
  masterVolume: number
  setMasterVolume: (volume: number) => void
  getParticipantVolume: (userId: string) => number
  setParticipantVolume: (userId: string, volume: number) => void
}

export const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

// Conexão de voz vive aqui, FORA da árvore de "qual canal estou vendo
// agora" — é por isso que trocar pra um canal de texto não te tira mais
// da chamada. Só a chamada explícita de leave() desconecta de verdade.
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const audioSettingsRef = useRef(audioSettings)
  audioSettingsRef.current = audioSettings

  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null)
  const [connectedServerId, setConnectedServerId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
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
    setConnecting(true)
    setError(null)
    hasSyncedRef.current = false

    try {
      const stream = await getUserMediaWithRetry({ audio: audioSettingsRef.current.getAudioConstraints() })
      localStreamRef.current = stream
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
    track.enabled = !newMuted
    setMuted(newMuted)
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
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Trava em 1080p/30fps — dá uma imagem nítida sem exigir
          // tanto da GPU/CPU quanto capturar em resolução/taxa maiores,
          // que é o que mais rouba desempenho de jogos rodando junto.
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      // Avisa a sala ANTES de adicionar a track — o broadcast chega quase
      // instantâneo, enquanto a renegociação WebRTC (oferta/resposta/ICE)
      // leva alguns round-trips, então o aviso quase sempre chega primeiro.
      broadcastScreenMeta(stream.id)
      const track = stream.getVideoTracks()[0]
      // "motion" prioriza fluidez de movimento em vez de nitidez de
      // texto estático — melhor pra compartilhar jogo/vídeo do que a
      // opção padrão, que otimiza pra tela parada (documento, planilha)
      track.contentHint = 'motion'
      track.onended = () => {
        screenStreamRef.current = null
        setLocalScreenStream(null)
        setScreenSharing(false)
        broadcastScreenMeta(null)
      }
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.addTrack(track, stream)
        // Limita o bitrate e prioriza manter os quadros por segundo
        // (em vez de resolução) quando a conexão/CPU não aguentar tudo
        // — pra quem tá jogando, uma imagem um pouco mais simples mas
        // fluida é bem melhor que uma nítida só que travando.
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        params.encodings[0].maxBitrate = 4_000_000
        ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-framerate'
        sender.setParameters(params).catch(() => {
          // alguns navegadores/drivers não suportam todos os campos — sem problema, segue com o padrão
        })
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
        toggleVideo,
        toggleScreenShare,
        changeMicrophone,
        refreshAudioConstraints,
        audioSettings,
        maxParticipants: MAX_PARTICIPANTS,
        masterVolume,
        setMasterVolume,
        getParticipantVolume,
        setParticipantVolume,
      }}
    >
      {children}
    </VoiceContext.Provider>
  )
}
