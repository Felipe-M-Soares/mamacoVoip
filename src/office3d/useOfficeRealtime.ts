import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { openSharedChannel } from '../lib/realtimeChannel'

// Emotes e "acenar pra alguém" no modo Escritório. É só broadcast do
// Realtime no tópico `office:<servidor>` (PARTE 31 da 007 libera pra
// membros do servidor): nada é gravado no banco e nada passa pelo
// servidor de voz. Limite: 1 envio a cada 1,5 s por pessoa.
export const OFFICE_EMOTES = ['👋', '🎉', '😂', '❤️', '👍', '🔥', '😮', '🤔', '😴'] as const
const SEND_GAP_MS = 1500

export type OfficeSignal =
  | { kind: 'emote'; from: string; emoji: string }
  | { kind: 'wave'; from: string; to: string }

export function useOfficeRealtime(serverId: string, userId: string | undefined, onSignal: (s: OfficeSignal) => void) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSentRef = useRef(0)
  const cbRef = useRef(onSignal)
  cbRef.current = onSignal

  useEffect(() => {
    if (!serverId || !userId) return
    const close = openSharedChannel(`office:${serverId}`, { config: { broadcast: { self: false } } }, (rt) => {
      rt.on('broadcast', { event: 'emote' }, ({ payload }) => {
        const from = payload?.from, emoji = payload?.emoji
        if (typeof from !== 'string' || typeof emoji !== 'string' || from === userId) return
        if (!(OFFICE_EMOTES as readonly string[]).includes(emoji)) return
        cbRef.current({ kind: 'emote', from, emoji })
      })
      rt.on('broadcast', { event: 'wave' }, ({ payload }) => {
        const from = payload?.from, to = payload?.to
        if (typeof from !== 'string' || typeof to !== 'string' || from === userId) return
        cbRef.current({ kind: 'wave', from, to })
      })
      rt.subscribe()
      channelRef.current = rt
    })
    return () => {
      close()
      channelRef.current = null
    }
  }, [serverId, userId])

  const send = useCallback(
    (event: 'emote' | 'wave', payload: Record<string, string>) => {
      const now = Date.now()
      if (!channelRef.current || !userId || now - lastSentRef.current < SEND_GAP_MS) return false
      lastSentRef.current = now
      void channelRef.current.send({ type: 'broadcast', event, payload: { from: userId, ...payload } })
      return true
    },
    [userId]
  )
  const sendEmote = useCallback((emoji: string) => send('emote', { emoji }), [send])
  const sendWave = useCallback((to: string) => send('wave', { to }), [send])
  return { sendEmote, sendWave }
}
