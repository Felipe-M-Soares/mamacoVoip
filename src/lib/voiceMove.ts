import type { Channel, VoiceMoveRequest } from '../types/database'

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

export function isVoiceMemberDrag(types: ReadonlyArray<string> | DOMStringList | null | undefined): boolean {
  if (!types) return false
  return Array.from(types as ArrayLike<string>).includes(VOICE_MEMBER_DRAG_TYPE)
}

export function canDropVoiceMemberOn(
  channel: Pick<Channel, 'id' | 'type' | 'server_id'>,
  source: { fromChannelId: string; serverId: string } | null
): boolean {
  if (channel.type !== 'voice') return false
  if (!source) return true
  return channel.server_id === source.serverId && channel.id !== source.fromChannelId
}

export function shouldApplyVoiceMove(
  request: Pick<VoiceMoveRequest, 'server_id' | 'target_user_id' | 'to_channel_id'>,
  state: { myUserId: string | null | undefined; connectedServerId: string | null; connectedChannelId: string | null }
): boolean {
  if (!state.myUserId || request.target_user_id !== state.myUserId) return false
  if (!state.connectedServerId || !state.connectedChannelId) return false
  if (request.server_id !== state.connectedServerId) return false
  return request.to_channel_id !== state.connectedChannelId
}

export function describeVoiceMoveError(message: string | null | undefined): string {
  const text = (message ?? '').trim()
  if (!text) return 'Não foi possível mover o membro.'
  if (/could not find the function|does not exist|PGRST202/i.test(text)) {
    return 'Mover membros não está disponível no momento.'
  }
  if (/failed to fetch|network|fetch/i.test(text)) {
    return 'Sem conexão — não foi possível mover o membro.'
  }
  return text
}
