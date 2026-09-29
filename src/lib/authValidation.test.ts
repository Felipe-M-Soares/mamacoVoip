import { describe, it, expect } from 'vitest'
import {
  validatePassword,
  validateUsername,
  validateEmail,
  normalizeEmail,
  safeRedirectPath,
  isValidInviteCode,
  normalizeTotpCode,
  passwordStrength,
} from './authValidation'

describe('validatePassword', () => {
  it('exige no mínimo 8 caracteres', () => {
    expect(validatePassword('abc123')).toMatch(/mínimo 8/)
  })
  it('exige letra e número', () => {
    expect(validatePassword('abcdefgh')).toMatch(/letra e um número/)
    expect(validatePassword('12345678')).toMatch(/letra e um número/)
  })
  it('recusa senha com mais de 72 bytes', () => {
    expect(validatePassword('a1'.repeat(40))).toMatch(/máximo 72/)
  })
  it('recusa senha contendo o e-mail ou usuário', () => {
    expect(validatePassword('joao12345', { email: 'joao@x.com' })).toMatch(/e-mail/)
    expect(validatePassword('xmamaco99', { username: 'mamaco' })).toMatch(/usuário/)
  })
  it('recusa espaço nas pontas', () => {
    expect(validatePassword(' senha1234')).toMatch(/espaço/)
  })
  it('aceita senha razoável', () => {
    expect(validatePassword('correcthorse9')).toBeNull()
  })
  it('força cresce com variedade', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('Abcdefgh1!xyz')).toBe(4)
  })
})

describe('validateUsername', () => {
  it('valida tamanho e caracteres', () => {
    expect(validateUsername('ab')).not.toBeNull()
    expect(validateUsername('a'.repeat(33))).not.toBeNull()
    expect(validateUsername('joão')).not.toBeNull()
    expect(validateUsername('.joao')).not.toBeNull()
    expect(validateUsername('jo..ao')).not.toBeNull()
    expect(validateUsername('everyone')).not.toBeNull()
    expect(validateUsername('joao_silva.99')).toBeNull()
  })
})

describe('email', () => {
  it('normaliza e valida', () => {
    expect(normalizeEmail('  Joao@Gmail.COM ')).toBe('joao@gmail.com')
    expect(validateEmail('joao@gmail.com')).toBeNull()
    expect(validateEmail('joao@')).not.toBeNull()
    expect(validateEmail('')).not.toBeNull()
  })
})

describe('safeRedirectPath', () => {
  it('aceita caminhos internos', () => {
    expect(safeRedirectPath('/convite/abc123')).toBe('/convite/abc123')
    expect(safeRedirectPath('/convite/abc?canal=1')).toBe('/convite/abc?canal=1')
  })
  it('recusa destinos externos ou estranhos', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/')
    expect(safeRedirectPath('/\\evil.com')).toBe('/')
    expect(safeRedirectPath('https://evil.com')).toBe('/')
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/')
    expect(safeRedirectPath('/login')).toBe('/')
    expect(safeRedirectPath(null)).toBe('/')
    expect(safeRedirectPath('/a\nb')).toBe('/')
  })
})

describe('convite e TOTP', () => {
  it('valida formato do código de convite', () => {
    expect(isValidInviteCode('a1b2c3d4')).toBe(true)
    expect(isValidInviteCode('Ab3dE9xZq1')).toBe(true)
    expect(isValidInviteCode("x' or 1=1")).toBe(false)
    expect(isValidInviteCode('')).toBe(false)
  })
  it('normaliza código TOTP', () => {
    expect(normalizeTotpCode(' 12 34-56 7')).toBe('123456')
  })
})
