import { beforeEach, describe, expect, it } from 'vitest'
import { createAuthStorage, type SecureStorageBridge } from './authStorage'

function memoryBridge(available = true) {
  const data = new Map<string, string>()
  const bridge: SecureStorageBridge = {
    getItem: async (key) => (available ? { ok: true, value: data.get(key) ?? null } : { ok: false }),
    setItem: async (key, value) => {
      if (!available) return { ok: false }
      data.set(key, value)
      return { ok: true }
    },
    removeItem: async (key) => {
      data.delete(key)
      return { ok: available }
    },
  }
  return { bridge, data }
}

describe('createAuthStorage', () => {
  beforeEach(() => localStorage.clear())

  it('sem ponte (web) usa localStorage', async () => {
    const storage = createAuthStorage(null)
    await storage.setItem('sb-x-auth-token', 'v')
    expect(localStorage.getItem('sb-x-auth-token')).toBe('v')
    expect(await storage.getItem('sb-x-auth-token')).toBe('v')
    await storage.removeItem('sb-x-auth-token')
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull()
  })

  it('com ponte grava no cofre e não deixa cópia em texto puro', async () => {
    const { bridge, data } = memoryBridge()
    const storage = createAuthStorage(bridge)
    await storage.setItem('sb-x-auth-token', 'segredo')
    expect(data.get('sb-x-auth-token')).toBe('segredo')
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull()
    expect(await storage.getItem('sb-x-auth-token')).toBe('segredo')
  })

  it('migra a sessão antiga do localStorage sem deslogar', async () => {
    localStorage.setItem('sb-x-auth-token', 'sessao-antiga')
    const { bridge, data } = memoryBridge()
    const storage = createAuthStorage(bridge)
    expect(await storage.getItem('sb-x-auth-token')).toBe('sessao-antiga')
    expect(data.get('sb-x-auth-token')).toBe('sessao-antiga')
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull()
  })

  it('sem cifragem disponível cai no localStorage', async () => {
    const { bridge } = memoryBridge(false)
    const storage = createAuthStorage(bridge)
    await storage.setItem('sb-x-auth-token', 'v')
    expect(localStorage.getItem('sb-x-auth-token')).toBe('v')
    expect(await storage.getItem('sb-x-auth-token')).toBe('v')
  })

  it('chaves fora do prefixo sb- não passam pelo cofre', async () => {
    const { bridge, data } = memoryBridge()
    const storage = createAuthStorage(bridge)
    await storage.setItem('outra', 'v')
    expect(data.size).toBe(0)
    expect(localStorage.getItem('outra')).toBe('v')
  })
})
