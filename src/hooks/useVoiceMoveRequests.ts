import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uniqueTopic } from '../lib/realtimeChannel'
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

// Escuta os pedidos de "mover para outro canal de voz" (migration 014)
// feitos por um dono/moderador e troca de sala sozinho. A fonte é a
// tabela voice_move_requests (só a RPC move_voice_member grava, depois
// de validar permissão/hierarquia) — nunca um broadcast do Realtime, que
// qualquer cliente conseguiria forjar.
//
// Montado UMA vez (VoiceMovedToast, no MainLayout). Fica fora do
// VoiceContext de propósito: usa só join/leave públicos, igual ao
// "canal AFK" (leave() e, logo depois, join() no destino).
export function useVoiceMoveRequests() {
  const { user } = useAuth()
  const voice = useVoice()
  const [notices, setNotices] = useState<VoiceMoveNotice[]>([])

  // Sempre a versão mais recente do contexto — o callback do Realtime é
  // registrado uma vez só e não pode ficar com um estado velho.
  const voiceRef = useRef(voice)
  voiceRef.current = voice
  const handledIdsRef = useRef<Set<string>>(new Set())
  // Mudo/ensurdecido de antes da troca, reaplicado quando a entrada no
  // canal novo terminar (leave() zera os dois). Sem isso, quem estava
  // mudo seria "desmutado" à força ao ser movido.
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
      // Mesmo intervalo do canal AFK (VoiceContext): dá tempo da presença
      // antiga começar a sair antes de assinar a sala nova.
      setTimeout(() => {
        void voiceRef.current.join(request.to_channel_id, serverId).finally(() => {
          // Se a entrada falhou, não deixa o "reaplicar mudo" pendurado
          // pra uma próxima entrada manual nesse mesmo canal.
          setTimeout(() => {
            if (pendingRestoreRef.current?.channelId === request.to_channel_id) pendingRestoreRef.current = null
          }, 1500)
        })
      }, 300)

      if (request.requested_by === myUserId) return // moveu a si mesmo: sem aviso

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

  // Reaplica mudo/ensurdecido assim que a conexão no canal novo sobe.
  // Usa as funções do render ATUAL (toggleDeafen lê o volume do estado).
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
    const channel = supabase
      .channel(uniqueTopic(`voice_moves:${userId}`))
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
