import { describe, expect, it } from 'vitest'
import {
  VOICE_MEMBER_DRAG_TYPE,
  canDropVoiceMemberOn,
  decodeVoiceMemberDrag,
  describeVoiceMoveError,
  encodeVoiceMemberDrag,
  isVoiceMemberDrag,
  shouldApplyVoiceMove,
} from './voiceMove'

describe('arraste de participante de voz', () => {
  it('codifica e decodifica o payload', () => {
    const payload = { userId: 'u1', fromChannelId: 'c1', serverId: 's1' }
    expect(decodeVoiceMemberDrag(encodeVoiceMemberDrag(payload))).toEqual(payload)
  })

  it('rejeita payload inválido', () => {
    expect(decodeVoiceMemberDrag('')).toBeNull()
    expect(decodeVoiceMemberDrag(null)).toBeNull()
    expect(decodeVoiceMemberDrag('c1')).toBeNull() // id de canal (arraste de canal)
    expect(decodeVoiceMemberDrag('{"userId":"u1"}')).toBeNull()
    expect(decodeVoiceMemberDrag('{"userId":1,"fromChannelId":"c","serverId":"s"}')).toBeNull()
  })

  it('reconhece o tipo próprio no dataTransfer', () => {
    expect(isVoiceMemberDrag([VOICE_MEMBER_DRAG_TYPE])).toBe(true)
    expect(isVoiceMemberDrag(['text/plain'])).toBe(false)
    expect(isVoiceMemberDrag(undefined)).toBe(false)
  })

  it('só aceita soltar em outro canal de voz do mesmo servidor', () => {
    const src = { fromChannelId: 'c1', serverId: 's1' }
    expect(canDropVoiceMemberOn({ id: 'c2', type: 'voice', server_id: 's1' }, src)).toBe(true)
    expect(canDropVoiceMemberOn({ id: 'c1', type: 'voice', server_id: 's1' }, src)).toBe(false)
    expect(canDropVoiceMemberOn({ id: 'c3', type: 'text', server_id: 's1' }, src)).toBe(false)
    expect(canDropVoiceMemberOn({ id: 'c4', type: 'voice', server_id: 's2' }, src)).toBe(false)
    expect(canDropVoiceMemberOn({ id: 'c2', type: 'voice', server_id: 's1' }, null)).toBe(true)
  })
})

describe('shouldApplyVoiceMove', () => {
  const req = { server_id: 's1', target_user_id: 'me', to_channel_id: 'c2' }

  it('aplica quando está conectado em outra sala do mesmo servidor', () => {
    expect(shouldApplyVoiceMove(req, { myUserId: 'me', connectedServerId: 's1', connectedChannelId: 'c1' })).toBe(true)
  })

  it('ignora fora de call, em outro servidor, no mesmo canal ou para outra pessoa', () => {
    expect(shouldApplyVoiceMove(req, { myUserId: 'me', connectedServerId: null, connectedChannelId: null })).toBe(false)
    expect(shouldApplyVoiceMove(req, { myUserId: 'me', connectedServerId: 's9', connectedChannelId: 'c1' })).toBe(false)
    expect(shouldApplyVoiceMove(req, { myUserId: 'me', connectedServerId: 's1', connectedChannelId: 'c2' })).toBe(false)
    expect(shouldApplyVoiceMove(req, { myUserId: 'outro', connectedServerId: 's1', connectedChannelId: 'c1' })).toBe(false)
    expect(shouldApplyVoiceMove(req, { myUserId: null, connectedServerId: 's1', connectedChannelId: 'c1' })).toBe(false)
  })
})

describe('describeVoiceMoveError', () => {
  it('traduz função ausente e rede, repassa as mensagens da RPC', () => {
    expect(describeVoiceMoveError('Could not find the function public.move_voice_member')).toMatch(/migration 007/)
    expect(describeVoiceMoveError('TypeError: Failed to fetch')).toMatch(/Sem conexão/)
    expect(describeVoiceMoveError('Você não tem permissão para mover membros')).toBe('Você não tem permissão para mover membros')
    expect(describeVoiceMoveError(undefined)).toBe('Não foi possível mover o membro.')
  })
})
