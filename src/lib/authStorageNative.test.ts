import { beforeEach, describe, expect, it } from 'vitest'
import { createNativeAuthStorage, type NativePrefs } from './authStorage'

function fakePrefs(): NativePrefs & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async ({ key }) => ({ value: data.get(key) ?? null }),
    set: async ({ key, value }) => void data.set(key, value),
    remove: async ({ key }) => void data.delete(key),
  }
}

describe('createNativeAuthStorage', () => {
  beforeEach(() => localStorage.clear())
  it('grava e lê no armazenamento nativo', async () => {
    const p = fakePrefs()
    const s = createNativeAuthStorage(async () => p)
    await s.setItem('sb-x-auth-token', 'sessao')
    expect(p.data.get('sb-x-auth-token')).toBe('sessao')
    expect(await s.getItem('sb-x-auth-token')).toBe('sessao')
    await s.removeItem('sb-x-auth-token')
    expect(await s.getItem('sb-x-auth-token')).toBeNull()
  })
  it('migra a sessão antiga do localStorage sem deslogar', async () => {
    localStorage.setItem('sb-x-auth-token', 'antiga')
    const p = fakePrefs()
    const s = createNativeAuthStorage(async () => p)
    expect(await s.getItem('sb-x-auth-token')).toBe('antiga')
    expect(p.data.get('sb-x-auth-token')).toBe('antiga')
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull()
  })
  it('sem plugin cai no localStorage', async () => {
    const s = createNativeAuthStorage(async () => {
      throw new Error('sem plugin')
    })
    await s.setItem('k', 'v')
    expect(localStorage.getItem('k')).toBe('v')
  })
})
