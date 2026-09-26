import { describe, it, expect } from 'vitest'
import { describeError } from './errors'

describe('describeError', () => {
  it('extrai .message de um erro estilo PostgrestError', () => {
    expect(describeError({ message: 'new row violates row-level security policy' }, 'fallback')).toBe(
      'new row violates row-level security policy'
    )
  })

  it('inclui código e dica quando presentes', () => {
    const result = describeError(
      { message: 'permission denied', code: '42501', hint: 'confira as policies de RLS' },
      'fallback'
    )
    expect(result).toContain('permission denied')
    expect(result).toContain('código: 42501')
    expect(result).toContain('dica: confira as policies de RLS')
  })

  it('usa .message de um Error normal do JS', () => {
    expect(describeError(new Error('algo quebrou'), 'fallback')).toBe('algo quebrou')
  })

  it('cai no fallback quando o erro não tem informação útil', () => {
    expect(describeError({}, 'fallback')).toBe('fallback')
    expect(describeError(null, 'fallback')).toBe('fallback')
    expect(describeError(undefined, 'fallback')).toBe('fallback')
    expect(describeError('string crua', 'fallback')).toBe('fallback')
  })
})
