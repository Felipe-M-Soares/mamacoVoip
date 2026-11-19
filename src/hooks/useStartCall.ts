import { useCallback, useRef } from 'react'
import { useVoiceCore } from './useVoice'

export const CALL_MESSAGE = '📞 Iniciou uma chamada de voz'

const ANNOUNCE_GAP_MS = 2 * 60 * 1000
const lastAnnounce = new Map<string, number>()

export function isCallMessage(content: string | null | undefined): boolean {
  return (content ?? '').startsWith(CALL_MESSAGE)
}

export function useStartCall(
  roomId: string,
  displayName: string,
  selfId: string | null | undefined,
  sendMessage: (content: string) => Promise<{ error: string | null }>
) {
  const voice = useVoiceCore()
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  return useCallback(async () => {
    await voice.join(roomId, null, { displayName })
    window.setTimeout(() => {
      const v = voiceRef.current
      if (v.connectedChannelId !== roomId) return
      const others = Object.keys(v.participants).filter((id) => id !== selfId)
      if (others.length) return
      const last = lastAnnounce.get(roomId) ?? 0
      if (Date.now() - last < ANNOUNCE_GAP_MS) return
      lastAnnounce.set(roomId, Date.now())
      void sendMessage(CALL_MESSAGE)
    }, 2500)
  }, [voice, roomId, displayName, selfId, sendMessage])
}
