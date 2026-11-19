import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { openSharedChannel } from '../lib/realtimeChannel'

export const OFFICE_EMOTES = ['👋', '🎉', '😂', '❤️', '👍', '🔥', '😮', '🤔', '😴', '👏', '💃', '😡', '🫡', '👎'] as const
const SEND_GAP_MS = 1500

export type OfficeSignal =
  | { kind: 'emote'; from: string; emoji: string }
  | { kind: 'wave'; from: string; to: string }
  | { kind: 'kart'; from: string; type: string; d: Record<string, unknown> }

export function useOfficeRealtime(serverId: string, userId: string | undefined, onSignal: (s: OfficeSignal) => void) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSentRef = useRef(0)
  const cbRef = useRef(onSignal)
  cbRef.current = onSignal

  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!serverId || !userId) return
    let retryT: ReturnType<typeof setTimeout> | null = null
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
      rt.on('broadcast', { event: 'kart' }, ({ payload }) => {
        const from = payload?.from, type = payload?.type, d = payload?.d
        if (typeof from !== 'string' || typeof type !== 'string' || from === userId || !d || typeof d !== 'object') return
        cbRef.current({ kind: 'kart', from, type, d })
      })
      rt.subscribe((status) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !retryT) retryT = setTimeout(() => setRetry((n) => n + 1), 4000)
      })
      channelRef.current = rt
    })
    return () => {
      if (retryT) clearTimeout(retryT)
      close()
      channelRef.current = null
    }
  }, [serverId, userId, retry])

  const pendingRef = useRef<{ event: 'emote' | 'wave'; payload: Record<string, string> } | null>(null)
  const pendingTRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pendingTRef.current) clearTimeout(pendingTRef.current) }, [])
  const send = useCallback(
    (event: 'emote' | 'wave', payload: Record<string, string>) => {
      if (!userId) return false
      const flush = () => {
        pendingTRef.current = null
        const p = pendingRef.current
        pendingRef.current = null
        if (!p || !channelRef.current) return
        lastSentRef.current = Date.now()
        void channelRef.current.send({ type: 'broadcast', event: p.event, payload: { from: userId, ...p.payload } })
      }
      pendingRef.current = { event, payload }
      const wait = SEND_GAP_MS - (Date.now() - lastSentRef.current)
      if (wait <= 0) flush()
      else if (!pendingTRef.current) pendingTRef.current = setTimeout(flush, wait)
      return true
    },
    [userId]
  )
  const sendKart = useCallback(
    (type: string, d: Record<string, unknown>) => {
      if (!userId || !channelRef.current) return
      void channelRef.current.send({ type: 'broadcast', event: 'kart', payload: { from: userId, type, d } })
    },
    [userId]
  )
  const sendEmote = useCallback((emoji: string) => send('emote', { emoji }), [send])
  const sendWave = useCallback((to: string) => send('wave', { to }), [send])
  return { sendEmote, sendWave, sendKart }
}
