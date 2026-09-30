import { useEffect, useState } from 'react'
import { getActiveVoiceRoom } from '../lib/livekit'
import { extractMediaPath, type MediaPathInfo } from '../lib/webrtcRtt'

const POLL_MS = 3_000

/**
 * RTT real (WebRTC getStats, candidate-pair em uso) até o servidor de mídia
 * do LiveKit, atualizado a cada 3s enquanto `active` (em call). Usa o
 * microfone publicado; se você só ouve (Palco/sem mic), usa uma track
 * remota — as duas passam pelo mesmo servidor. `null` enquanto não mede.
 */
export function useVoiceMediaRtt(active: boolean): MediaPathInfo | null {
  const [info, setInfo] = useState<MediaPathInfo | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false

    async function measure() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const room = getActiveVoiceRoom()
      if (!room || room.state !== 'connected') return
      const tracks = [
        ...Array.from(room.localParticipant.trackPublications.values()),
        ...Array.from(room.remoteParticipants.values()).flatMap((p) => Array.from(p.trackPublications.values())),
      ]
        .map((pub) => pub.track)
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
      for (const track of tracks) {
        try {
          const path = extractMediaPath(await track.getRTCStatsReport())
          if (path) {
            if (!cancelled) setInfo(path)
            return
          }
        } catch {
          // track saindo no meio da medição — tenta a próxima
        }
      }
    }

    void measure()
    const interval = setInterval(() => void measure(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
      setInfo(null)
    }
  }, [active])

  return active ? info : null
}
