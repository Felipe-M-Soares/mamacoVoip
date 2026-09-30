import { describe, it, expect } from 'vitest'
import {
  buildGamePreset,
  contentHintForPreset,
  exceedsH264FrameLimits,
  fitWithin,
  loadGameAutoPreset,
  loadQualityPreset,
  resolveScreenSharePreset,
} from './useScreenShareQuality'

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

describe('preset automático "Jogo"', () => {
  const user1080p30 = { ...loadQualityPreset(), width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_000_000 }

  it('usa 1080p60 com ~7 Mbps e prioriza fluidez', () => {
    const p = buildGamePreset(user1080p30, { weakNetwork: false })
    expect(p).toMatchObject({ width: 1920, height: 1080, frameRate: 60, degradationPreference: 'maintain-framerate', isGamePreset: true })
    expect(p.maxBitrate).toBeGreaterThanOrEqual(6_000_000)
    expect(p.maxBitrate).toBeLessThanOrEqual(8_000_000)
    expect(contentHintForPreset(p)).toBe('motion')
  })

  it('cai pra 720p60 em rede fraca', () => {
    const p = buildGamePreset(user1080p30, { weakNetwork: true })
    expect(p).toMatchObject({ width: 1280, height: 720, frameRate: 60 })
    expect(p.maxBitrate).toBeLessThan(5_000_000)
  })

  it('respeita quem escolheu 1440p sem passar do teto de segurança', () => {
    const p = buildGamePreset({ width: 2560, height: 1440 }, { weakNetwork: false })
    expect(p.width).toBe(2560)
    expect(p.height).toBe(1440)
    expect(p.frameRate).toBe(60)
    const huge = buildGamePreset({ width: 7680, height: 4320 }, { weakNetwork: false })
    expect(huge.width).toBeLessThanOrEqual(2560)
    expect(huge.height).toBeLessThanOrEqual(1440)
    expect(huge.capResolution).toBe(true)
  })

  it('só troca o preset quando a fonte é jogo E o modo automático está ligado', () => {
    expect(resolveScreenSharePreset(user1080p30, { isGame: false, gameAuto: true, weakNetwork: false })).toBe(user1080p30)
    expect(resolveScreenSharePreset(user1080p30, { isGame: true, gameAuto: false, weakNetwork: false })).toBe(user1080p30)
    expect(resolveScreenSharePreset(user1080p30, { isGame: true, gameAuto: true, weakNetwork: false }).isGamePreset).toBe(true)
  })

  it('modo automático vem ligado por padrão', () => {
    localStorage.removeItem('mamacos-screenshare-game-auto')
    expect(loadGameAutoPreset()).toBe(true)
    localStorage.setItem('mamacos-screenshare-game-auto', 'false')
    expect(loadGameAutoPreset()).toBe(false)
    localStorage.removeItem('mamacos-screenshare-game-auto')
  })
})
