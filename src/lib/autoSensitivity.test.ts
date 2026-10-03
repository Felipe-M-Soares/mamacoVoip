import { describe, expect, it } from 'vitest'
import { createAutoSensitivity } from './autoSensitivity'

describe('createAutoSensitivity', () => {
  it('fica 16 dB acima do ruído de fundo, ignorando picos de fala/teclado', () => {
    const a = createAutoSensitivity()
    let t: number | null = null
    for (let i = 0; i < 40; i++) {
      // ruído ~-60 dB com picos de -25 dB (fala/teclado) a cada 3 leituras
      const r = a.push(i % 3 === 0 ? -25 : -60)
      if (r !== null) t = r
    }
    expect(t).toBe(-44)
  })
  it('nunca desce de -55 dB em sala silenciosa', () => {
    const a = createAutoSensitivity()
    let t: number | null = null
    for (let i = 0; i < 20; i++) t = a.push(-80) ?? t
    expect(t).toBe(-55)
  })
  it('nunca passa de -30 dB em sala barulhenta', () => {
    const a = createAutoSensitivity()
    let t: number | null = null
    for (let i = 0; i < 20; i++) t = a.push(-20) ?? t
    expect(t).toBe(-30)
  })
})
