import { describe, it, expect } from 'vitest'
import { contentHintForPreset, exceedsH264FrameLimits, fitWithin, loadQualityPreset } from './useScreenShareQuality'

describe('teto de segurança da captura de tela', () => {
  it('reduz 4K pra caber em 2560x1440 mantendo a proporção', () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 2560, height: 1440 })
  })
  it('reduz ultrawide/multi-monitor e mantém dimensões pares', () => {
    const r = fitWithin(5120, 1440)
    expect(r.width).toBe(2560)
    expect(r.height).toBe(720)
    const odd = fitWithin(3441, 1441)
    expect(odd.width % 2).toBe(0)
    expect(odd.height % 2).toBe(0)
    expect(odd.width).toBeLessThanOrEqual(2560)
    expect(odd.height).toBeLessThanOrEqual(1440)
  })
  it('nunca aumenta uma tela menor', () => {
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })
  it('detecta quadros acima do limite do H.264 (nível 5.2)', () => {
    expect(exceedsH264FrameLimits(3840, 2160)).toBe(false)
    expect(exceedsH264FrameLimits(5120, 1440)).toBe(true)
    expect(exceedsH264FrameLimits(7680, 4320)).toBe(true)
  })
  it('preset padrão sempre tem teto de resolução', () => {
    const preset = loadQualityPreset()
    expect(preset.capResolution).toBe(true)
    expect(preset.width).toBeLessThanOrEqual(2560)
    expect(preset.height).toBeLessThanOrEqual(1440)
  })
})

describe('contentHintForPreset', () => {
  it('usa "detail" em 15fps (texto/documento)', () => {
    expect(contentHintForPreset({ frameRate: 15 })).toBe('detail')
  })
  it('usa "motion" em 30/60fps (jogo/vídeo)', () => {
    expect(contentHintForPreset({ frameRate: 30 })).toBe('motion')
    expect(contentHintForPreset({ frameRate: 60 })).toBe('motion')
  })
})
