import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './mobileUpdate'

describe('isNewerVersion', () => {
  it('compara as versões do app', () => {
    expect(isNewerVersion('v1.0.280', '1.0.271')).toBe(true)
    expect(isNewerVersion('1.0.271', '1.0.271')).toBe(false)
    expect(isNewerVersion('1.0.99', '1.0.100')).toBe(false)
    expect(isNewerVersion('1.1.0', '1.0.300')).toBe(true)
    expect(isNewerVersion('1.0.5', '1.0')).toBe(true)
  })
})
