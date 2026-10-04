import { describe, expect, it } from 'vitest'
import { channelNameFor, orderChannels } from './channelName'

describe('channelNameFor', () => {
  it('texto vira slug', () => expect(channelNameFor('text', '  Caçando  Monstro ')).toBe('caçando-monstro'))
  it('voz mantém o nome', () => expect(channelNameFor('voice', '  Caçando  Monstro ')).toBe('Caçando Monstro'))
})

describe('orderChannels', () => {
  it('texto antes de voz', () => {
    const r = orderChannels([
      { id: 'v1', type: 'voice' as const, position: 0 },
      { id: 't2', type: 'text' as const, position: 3 },
      { id: 't1', type: 'text' as const, position: 1 },
    ])
    expect(r.text.map((c) => c.id)).toEqual(['t1', 't2'])
    expect(r.voice.map((c) => c.id)).toEqual(['v1'])
  })
})
