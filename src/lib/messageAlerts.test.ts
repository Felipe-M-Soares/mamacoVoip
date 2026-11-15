import { describe, expect, it, vi } from 'vitest'
import { decideAlert, emitIncomingMessage, onIncomingMessage, previewText } from './messageAlerts'

const msg = { targetId: 'c1', authorId: 'u2' }

describe('decideAlert', () => {
  it('ignora mensagem própria e de bloqueado', () => {
    expect(decideAlert({ message: { ...msg, authorId: 'me' }, myId: 'me', viewingTargetId: null, appFocused: true })).toBe('none')
    expect(
      decideAlert({ message: msg, myId: 'me', viewingTargetId: null, appFocused: true, blockedIds: new Set(['u2']) })
    ).toBe('none')
  })
  it('não avisa quem já está olhando a conversa', () => {
    expect(decideAlert({ message: msg, myId: 'me', viewingTargetId: 'c1', appFocused: true })).toBe('none')
  })
  it('aviso no canto com o app em foco em outro lugar', () => {
    expect(decideAlert({ message: msg, myId: 'me', viewingTargetId: 'c9', appFocused: true })).toBe('toast')
    expect(decideAlert({ message: msg, myId: 'me', viewingTargetId: null, appFocused: true })).toBe('toast')
  })
  it('notificação do sistema com o app em segundo plano (mesmo com a conversa aberta)', () => {
    expect(decideAlert({ message: msg, myId: 'me', viewingTargetId: 'c1', appFocused: false })).toBe('system')
  })
})

describe('emitIncomingMessage', () => {
  it('entrega uma vez só por mensagem', () => {
    const cb = vi.fn()
    const off = onIncomingMessage(cb)
    const m = { kind: 'dm' as const, targetId: 'c1', messageId: 'm-dup-1', authorId: 'u2', content: 'oi' }
    emitIncomingMessage(m)
    emitIncomingMessage(m)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })
})

describe('previewText', () => {
  it('anexo sem texto e corte de texto longo', () => {
    expect(previewText('')).toBe('Enviou um anexo')
    expect(previewText('a  b\n c')).toBe('a b c')
    expect(previewText('x'.repeat(200), 10)).toHaveLength(10)
  })
})
