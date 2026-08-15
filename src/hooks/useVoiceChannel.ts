import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAudioSettings } from './useAudioSettings'

// Apenas STUN público está configurado neste ambiente. Um servidor TURN
// de verdade (coturn ou um serviço pago) precisa ser implantado à parte
// em produção — sem ele, peers atrás de NAT simétrico/restritivo podem
// não conseguir se conectar diretamente. Isso é uma limitação de
// infraestrutura, não do código de sinalização.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

// Mesh P2P: cada participante se conecta diretamente a todos os outros.
// Isso escala mal (N² conexões), então limitamos o tamanho da sala.
// Uma SFU (mediasoup, LiveKit) seria o próximo passo pra escalar de verdade.
const MAX_PARTICIPANTS = 8
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

export function useVoiceChannel(channelId: string | null, serverId: string | null) {
  const { user } = useAuth()
  const audioSettings = useAudioSettings()
  const audioSettingsRef = useRef(audioSettings)
  audioSettingsRef.current = audioSettings
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Record<string, VoiceParticipant>>({})
  const [muted, setMuted] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
  const [speaking, setSpeaking] = useState(false)

  const userIdRef = useRef<string | null>(null)
  userIdRef.current = user?.id ?? null

  const realtimeRef = useRef<RealtimeChannel | null>(null)
  const peersRef = useRef<Map<string, PeerState>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map())

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
      // getUserMedia/AudioContext podem falhar em navegadores sem suporte — degrada graciosamente (sem indicador de fala)
    }
  }

  function sendSignal(to: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const from = userIdRef.current
    if (!realtimeRef.current || !from) return
    realtimeRef.current.send({ type: 'broadcast', event: 'rtc', payload: { from, to, ...data } })
  }

  function createPeerConnection(peerId: string, polite: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peerState: PeerState = { pc, makingOffer: false, polite }
    peersRef.current.set(peerId, peerState)

    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!))
    screenStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, screenStreamRef.current!))

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
      setParticipants((prev) => {
        const existing = prev[peerId]
        const isFirstStream = !existing?.cameraStream
        return {
          ...prev,
          [peerId]: {
            userId: peerId,
            speaking: existing?.speaking ?? false,
            cameraStream: isFirstStream ? stream : existing?.cameraStream ?? null,
            screenStream: isFirstStream ? existing?.screenStream ?? null : stream,
          },
        }
      })
      // só a primeira stream (mic/câmera) alimenta o indicador de fala —
      // a segunda (compartilhamento de tela) normalmente não tem áudio de mic
      if (!peersRef.current.get(peerId) || !analysersRef.current.has(peerId)) {
        setupAnalyser(peerId, stream)
      }
    }

    return pc
  }

  function ensurePeer(peerId: string) {
    if (peersRef.current.has(peerId) || !userIdRef.current) return
    if (peersRef.current.size >= MAX_PARTICIPANTS - 1) return
    createPeerConnection(peerId, userIdRef.current > peerId)
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
    setParticipants((prev) => {
      if (!(peerId in prev)) return prev
      const next = { ...prev }
      delete next[peerId]
      return next
    })
  }

  const join = useCallback(async () => {
    if (!channelId || !serverId || !user || connecting || connected) return
    setConnecting(true)
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioSettingsRef.current.getAudioConstraints() })
      localStreamRef.current = stream
      setupAnalyser('local', stream)

      const rt = supabase.channel(`voice:${channelId}`, {
        config: { broadcast: { self: false }, presence: { key: user.id } },
      })
      realtimeRef.current = rt

      rt.on('broadcast', { event: 'rtc' }, ({ payload }) => handleSignal(payload as SignalPayload))

      rt.on('presence', { event: 'sync' }, () => {
        const state = rt.presenceState()
        const ids = Object.keys(state).filter((id) => id !== user.id)
        ids.forEach(ensurePeer)
        Array.from(peersRef.current.keys()).forEach((id) => {
          if (!ids.includes(id)) cleanupPeer(id)
        })
      })

      rt.on('presence', { event: 'leave' }, ({ key }: { key: string }) => cleanupPeer(key))

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

      setConnected(true)
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
  }, [channelId, serverId, user, connecting, connected, handleSignal])

  const leave = useCallback(() => {
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
    setConnected(false)
    setConnecting(false)
    setMuted(false)
    setVideoEnabled(false)
    setScreenSharing(false)
    setSpeaking(false)
  }, [])

  useEffect(() => () => leave(), [leave])

  // Sai automaticamente se o usuário trocar de canal/servidor
  useEffect(() => {
    return () => {
      if (connected) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  async function changeMicrophone(deviceId: string) {
    audioSettingsRef.current.setMicId(deviceId)
    if (!connected) return
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

      // troca a track em cada conexão sem precisar renegociar (offer/answer)
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        sender?.replaceTrack(newTrack)
      })

      setupAnalyser('local', newStream)
    } catch {
      setError('Não foi possível trocar de microfone.')
    }
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const newMuted = !muted
    track.enabled = !newMuted
    setMuted(newMuted)
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
      screenStreamRef.current = null
      setLocalScreenStream(null)
      setScreenSharing(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      const track = stream.getVideoTracks()[0]
      track.onended = () => {
        screenStreamRef.current = null
        setLocalScreenStream(null)
        setScreenSharing(false)
      }
      peersRef.current.forEach(({ pc }) => pc.addTrack(track, stream))
      setScreenSharing(true)
    } catch {
      setError('Não foi possível compartilhar a tela.')
    }
  }

  // Detecção de fala: amostra o nível de áudio de cada analyser a cada 200ms
  useEffect(() => {
    if (!connected) return
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
  }, [connected])

  return {
    connected,
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
    audioSettings,
    maxParticipants: MAX_PARTICIPANTS,
  }
}
