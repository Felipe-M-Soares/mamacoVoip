import { describe, expect, it } from 'vitest'
import { giphyRating, shouldGateAdultChannel } from './adultContent'

describe('shouldGateAdultChannel', () => {
  const base = { isNsfw: true, verified: false, showAdult: true, revealedThisVisit: false }

  it('nunca bloqueia canal comum', () => {
    expect(shouldGateAdultChannel({ ...base, isNsfw: false })).toBe(false)
  })

  it('bloqueia canal +18 sem confirmação de idade', () => {
    expect(shouldGateAdultChannel(base)).toBe(true)
  })

  it('libera quem confirmou e deixou "mostrar conteúdo +18" ligado', () => {
    expect(shouldGateAdultChannel({ ...base, verified: true })).toBe(false)
  })

  it('com a preferência desligada, pede confirmação a cada visita', () => {
    expect(shouldGateAdultChannel({ ...base, verified: true, showAdult: false })).toBe(true)
    expect(shouldGateAdultChannel({ ...base, verified: true, showAdult: false, revealedThisVisit: true })).toBe(false)
  })
})

describe('giphyRating', () => {
  it('usa pg-13 fora de canal +18 e r (máximo da GIPHY) dentro', () => {
    expect(giphyRating(false)).toBe('pg-13')
    expect(giphyRating(true)).toBe('r')
  })
})
