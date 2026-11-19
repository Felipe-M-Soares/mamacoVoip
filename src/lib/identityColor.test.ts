import { describe, expect, it } from 'vitest'
import { identityGradient } from './identityColor'

describe('identityColor', () => {
  it('é estável pro mesmo seed', () => {
    expect(identityGradient('ana')).toBe(identityGradient('ana'))
  })
  it('distribui seeds diferentes em cores diferentes', () => {
    const colors = new Set(['ana', 'bruno', 'carla', 'diego', 'eva', 'felipe', 'gabi', 'hugo'].map(identityGradient))
    expect(colors.size).toBeGreaterThan(3)
  })
  it('aceita string vazia', () => {
    expect(identityGradient('')).toMatch(/^linear-gradient/)
  })
})
