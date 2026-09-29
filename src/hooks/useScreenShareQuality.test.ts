import { describe, it, expect } from 'vitest'
import { contentHintForPreset } from './useScreenShareQuality'

describe('contentHintForPreset', () => {
  it('usa "detail" em 15fps (texto/documento)', () => {
    expect(contentHintForPreset({ frameRate: 15 })).toBe('detail')
  })
  it('usa "motion" em 30/60fps (jogo/vídeo)', () => {
    expect(contentHintForPreset({ frameRate: 30 })).toBe('motion')
    expect(contentHintForPreset({ frameRate: 60 })).toBe('motion')
  })
})
