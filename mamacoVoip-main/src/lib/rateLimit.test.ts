import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { checkRateLimit, rateLimitError } from './rateLimit'

// checkRateLimit usa Date.now() internamente pra decidir a janela —
// controla o relógio nos testes pra não depender de timing real (que
// deixaria os testes lentos e ocasionalmente instáveis).
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('checkRateLimit', () => {
  it('permite até o limite dentro da janela', () => {
    const key = `chave-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 10_000).allowed).toBe(true)
    }
  })

  it('bloqueia a chamada que estoura o limite', () => {
    const key = `chave-${Math.random()}`
    checkRateLimit(key, 2, 10_000)
    checkRateLimit(key, 2, 10_000)
    const result = checkRateLimit(key, 2, 10_000)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('libera de novo depois que a janela passa', () => {
    const key = `chave-${Math.random()}`
    checkRateLimit(key, 1, 10_000)
    expect(checkRateLimit(key, 1, 10_000).allowed).toBe(false)
    vi.advanceTimersByTime(10_001)
    expect(checkRateLimit(key, 1, 10_000).allowed).toBe(true)
  })

  it('mantém chaves diferentes completamente independentes', () => {
    const keyA = `a-${Math.random()}`
    const keyB = `b-${Math.random()}`
    checkRateLimit(keyA, 1, 10_000)
    expect(checkRateLimit(keyA, 1, 10_000).allowed).toBe(false)
    expect(checkRateLimit(keyB, 1, 10_000).allowed).toBe(true)
  })
})

describe('rateLimitError', () => {
  it('devolve null enquanto dentro do limite', () => {
    const key = `chave-${Math.random()}`
    expect(rateLimitError(key, 2, 10_000, 'testando')).toBeNull()
    expect(rateLimitError(key, 2, 10_000, 'testando')).toBeNull()
  })

  it('devolve uma mensagem em português quando estoura, incluindo o motivo passado', () => {
    const key = `chave-${Math.random()}`
    rateLimitError(key, 1, 10_000, 'você está mandando mensagem')
    const msg = rateLimitError(key, 1, 10_000, 'você está mandando mensagem')
    expect(msg).toContain('você está mandando mensagem')
    expect(msg).toMatch(/Espera \d+s/)
  })
})
