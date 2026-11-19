import { applyOutput, onAudioDevicesSettled } from '../../lib/audioDevices'
import { forwardRef, useEffect, useRef } from 'react'

function useSinkId(ref: { current: HTMLMediaElement | null }, sinkId: string | null | undefined) {
  useEffect(() => {
    const apply = () => void applyOutput(ref.current as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null, sinkId)
    apply()
    return onAudioDevicesSettled(apply)
  }, [ref, sinkId])
}

export const VideoTile = forwardRef<HTMLVideoElement, { stream: MediaStream; sinkId?: string | null; fit?: 'cover' | 'contain'; mirror?: boolean }>(
  function VideoTile({ stream, sinkId, fit = 'cover', mirror = false }, forwardedRef) {
    const localRef = useRef<HTMLVideoElement>(null)
    useEffect(() => {
      const el = localRef.current
      if (!el) return
      const videoOnly = new MediaStream(stream.getVideoTracks())
      const sync = () => {
        const tracks = stream.getVideoTracks()
        if (tracks.length !== videoOnly.getVideoTracks().length || tracks.some((t) => !videoOnly.getTrackById(t.id))) {
          for (const t of videoOnly.getVideoTracks()) videoOnly.removeTrack(t)
          for (const t of tracks) videoOnly.addTrack(t)
        }
      }
      stream.addEventListener('addtrack', sync)
      stream.addEventListener('removetrack', sync)
      el.srcObject = videoOnly
      el.muted = true
      const keepMuted = () => {
        if (!el.muted) el.muted = true
      }
      el.addEventListener('volumechange', keepMuted)
      return () => {
        stream.removeEventListener('addtrack', sync)
        stream.removeEventListener('removetrack', sync)
        el.removeEventListener('volumechange', keepMuted)
      }
    }, [stream])
    useSinkId(localRef, sinkId)
    return (
      <video
        ref={(node) => {
          localRef.current = node
          if (typeof forwardedRef === 'function') forwardedRef(node)
          else if (forwardedRef) forwardedRef.current = node
        }}
        autoPlay
        playsInline
        muted
        className={`w-full h-full rounded-[inherit] bg-black ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''}`}
      />
    )
  }
)

let sharedRemoteAudioContext: AudioContext | null = null
export function getSharedRemoteAudioContext(): AudioContext {
  if (!sharedRemoteAudioContext || sharedRemoteAudioContext.state === 'closed') {
    sharedRemoteAudioContext = new AudioContext({ latencyHint: 'interactive' })
  }
  return sharedRemoteAudioContext
}

let sharedRemoteAudioUsers = 0
let suspendTimer: ReturnType<typeof setTimeout> | null = null
function retainSharedRemoteAudioContext() {
  sharedRemoteAudioUsers++
  if (suspendTimer) {
    clearTimeout(suspendTimer)
    suspendTimer = null
  }
}
function releaseSharedRemoteAudioContext() {
  sharedRemoteAudioUsers = Math.max(0, sharedRemoteAudioUsers - 1)
  if (sharedRemoteAudioUsers > 0 || suspendTimer) return
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    if (sharedRemoteAudioUsers === 0 && sharedRemoteAudioContext?.state === 'running') {
      sharedRemoteAudioContext.suspend().catch(() => {})
    }
  }, 2000)
}

export function RemoteAudio({ stream, sinkId, volume }: { stream: MediaStream; sinkId?: string | null; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  useEffect(() => {
    if (stream.getAudioTracks().length === 0) {
      if (ref.current) ref.current.srcObject = null
      return
    }
    const keepAlive = new Audio()
    keepAlive.muted = true
    keepAlive.srcObject = stream
    keepAlive.play().catch(() => {})
    let retained = false
    try {
      const ctx = getSharedRemoteAudioContext()
      retainSharedRemoteAudioContext()
      retained = true
      const source = ctx.createMediaStreamSource(stream)
      const gain = ctx.createGain()
      const leveler = ctx.createDynamicsCompressor()
      leveler.threshold.value = -20
      leveler.knee.value = 12
      leveler.ratio.value = 4
      leveler.attack.value = 0.004
      leveler.release.value = 0.25
      const destination = ctx.createMediaStreamDestination()
      source.connect(gain)
      gain.connect(leveler)
      leveler.connect(destination)
      void ctx.resume().catch(() => {})
      audioContextRef.current = ctx
      sourceNodeRef.current = source
      gainNodeRef.current = gain
      gain.gain.value = Math.max(0, Math.min(2, volumeRef.current))
      if (ref.current) {
        ref.current.srcObject = destination.stream
        ref.current.volume = 1
      }
    } catch {
      audioContextRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
      if (ref.current) {
        ref.current.srcObject = stream
        ref.current.volume = Math.max(0, Math.min(1, volumeRef.current))
      }
    }
    return () => {
      try {
        sourceNodeRef.current?.disconnect()
      } catch {
      }
      try {
        gainNodeRef.current?.disconnect()
      } catch {
      }
      keepAlive.pause()
      keepAlive.srcObject = null
      if (retained) releaseSharedRemoteAudioContext()
      audioContextRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
    }
  }, [stream])
  useSinkId(ref, sinkId)
  useEffect(() => {
    const clamped = Math.max(0, Math.min(2, volume))
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = clamped
    } else if (ref.current) {
      ref.current.volume = Math.max(0, Math.min(1, clamped))
    }
  }, [volume])
  return <audio ref={ref} autoPlay />
}
