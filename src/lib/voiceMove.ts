// Utilitários puros do "mover membro entre canais de voz" (migration 014).
// Ficam fora dos componentes/hooks pra poder testar com vitest.

import type { Channel, VoiceMoveRequest } from '../types/database'

// Tipo próprio no dataTransfer — o arraste de CANAIS da barra lateral usa
// 'text/plain'; com um tipo separado um nunca é confundido com o outro.
export const VOICE_MEMBER_DRAG_TYPE = 'application/x-mamacos-voice-member'

export type VoiceMemberDragPayload = {
  userId: string
  fromChannelId: string
  serverId: string
}

export function encodeVoiceMemberDrag(payload: VoiceMemberDragPayload): string {
  return JSON.stringify(payload)
}

export function decodeVoiceMemberDrag(raw: string | null | undefined): VoiceMemberDragPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<VoiceMemberDragPayload> | null
    if (
      !parsed ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.fromChannelId !== 'string' ||
      typeof parsed.serverId !== 'string' ||
      !parsed.userId ||
      !parsed.fromChannelId ||
      !parsed.serverId
    ) {
      return null
    }
    return { userId: parsed.userId, fromChannelId: parsed.fromChannelId, serverId: parsed.serverId }
  } catch {
    return null
  }
}

/** O arraste em andamento é de um participante de voz? (dá pra ver no dragover, antes do drop) */
export function isVoiceMemberDrag(types: ReadonlyArray<string> | DOMStringList | null | undefined): boolean {
  if (!types) return false
  return Array.from(types as ArrayLike<string>).includes(VOICE_MEMBER_DRAG_TYPE)
}

/** Canal pode receber o participante arrastado? */
export function canDropVoiceMemberOn(
  channel: Pick<Channel, 'id' | 'type' | 'server_id'>,
  source: { fromChannelId: string; serverId: string } | null
): boolean {
  if (channel.type !== 'voice') return false
  if (!source) return true // durante o dragover o payload ainda não pode ser lido
  return channel.server_id === source.serverId && channel.id !== source.fromChannelId
}

/**
 * O pedido de "mover" que chegou pelo Realtime vale pra esta sessão?
 * Só se a pessoa está conectada numa sala de voz DESSE servidor e o
 * destino é outra sala. Se não está em call ali, ignora (o pedido é só
 * um "troque de sala", nunca "entre numa call").
 */
export function shouldApplyVoiceMove(
  request: Pick<VoiceMoveRequest, 'server_id' | 'target_user_id' | 'to_channel_id'>,
  state: { myUserId: string | null | undefined; connectedServerId: string | null; connectedChannelId: string | null }
): boolean {
  if (!state.myUserId || request.target_user_id !== state.myUserId) return false
  if (!state.connectedServerId || !state.connectedChannelId) return false
  if (request.server_id !== state.connectedServerId) return false
  return request.to_channel_id !== state.connectedChannelId
}

/** Mensagem de erro amigável (pt-BR) pro erro devolvido pela RPC move_voice_member. */
export function describeVoiceMoveError(message: string | null | undefined): string {
  const text = (message ?? '').trim()
  if (!text) return 'Não foi possível mover o membro.'
  if (/could not find the function|does not exist|PGRST202/i.test(text)) {
    return 'Mover membros ainda não está disponível neste servidor (falta aplicar a migration 014).'
  }
  if (/failed to fetch|network|fetch/i.test(text)) {
    return 'Sem conexão — não foi possível mover o membro.'
  }
  // As mensagens da RPC já vêm em pt-BR (ex.: "Você não tem permissão para mover membros").
  return text
}
