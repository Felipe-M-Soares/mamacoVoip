import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { changesChannel } from '../lib/realtimeChannel'
import { shouldApplyVoiceMove } from '../lib/voiceMove'
import type { VoiceMoveRequest } from '../types/database'
import { useAuth } from './useAuth'
import { useVoice } from './useVoice'

export type VoiceMoveNotice = {
  id: string
  channelName: string
  movedByName: string
  movedByAvatarUrl: string | null
}

export function useVoiceMoveRequests() {
  const { user } = useAuth()
  const voice = useVoice()
  const [notices, setNotices] = useState<VoiceMoveNotice[]>([])

  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const handledIdsRef = useRef<Set<string>>(new Set())
  const pendingRestoreRef = useRef<{ channelId: string; muted: boolean; deafened: boolean } | null>(null)

  const dismiss = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const handleRequest = useCallback(
    async (request: VoiceMoveRequest) => {
      const myUserId = user?.id
      if (!request?.id || handledIdsRef.current.has(request.id)) return
      handledIdsRef.current.add(request.id)

      const current = voiceRef.current
      if (
        !shouldApplyVoiceMove(request, {
          myUserId,
          connectedServerId: current.connectedServerId,
          connectedChannelId: current.connectedChannelId,
        })
      ) {
        return
      }

      pendingRestoreRef.current = {
        channelId: request.to_channel_id,
        muted: current.muted,
        deafened: current.deafened,
      }
      const serverId = request.server_id
      current.leave()
      setTimeout(() => {
        void voiceRef.current.join(request.to_channel_id, serverId).finally(() => {
          setTimeout(() => {
            if (pendingRestoreRef.current?.channelId === request.to_channel_id) pendingRestoreRef.current = null
          }, 1500)
        })
      }, 300)

      if (request.requested_by === myUserId) return

      const [{ data: channel }, { data: mover }] = await Promise.all([
        supabase.from('channels').select('name').eq('id', request.to_channel_id).maybeSingle(),
        supabase.from('profiles').select('username, display_name, avatar_url').eq('id', request.requested_by).maybeSingle(),
      ])
      const notice: VoiceMoveNotice = {
        id: request.id,
        channelName: channel?.name ?? 'outro canal',
        movedByName: mover?.display_name || mover?.username || 'um moderador',
        movedByAvatarUrl: mover?.avatar_url ?? null,
      }
      setNotices((prev) => [...prev.slice(-2), notice])
      setTimeout(() => dismiss(notice.id), 6000)
    },
    [user?.id, dismiss]
  )

  useEffect(() => {
    const pending = pendingRestoreRef.current
    if (!pending || voice.connectedChannelId !== pending.channelId) return
    pendingRestoreRef.current = null
    if (pending.deafened && !voice.deafened) {
      voice.toggleDeafen()
    } else if (pending.muted && !voice.muted) {
      voice.toggleMute()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.connectedChannelId])

  const handleRequestRef = useRef(handleRequest)
  handleRequestRef.current = handleRequest

  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    const channel = changesChannel(`voice_moves:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'voice_move_requests', filter: `target_user_id=eq.${userId}` },
        (payload) => {
          void handleRequestRef.current(payload.new as VoiceMoveRequest)
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id])

  return { notices, dismiss }
}
