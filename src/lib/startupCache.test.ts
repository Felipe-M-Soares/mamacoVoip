import { beforeEach, describe, expect, it } from 'vitest'
import { clearStartupCache, readStartupCache, writeStartupCache } from './startupCache'

describe('startupCache', () => {
  beforeEach(() => localStorage.clear())
  it('guarda, lê e expira em 7 dias', () => {
    writeStartupCache('servers:u1', [{ id: 's1' }], 1000)
    expect(readStartupCache('servers:u1', 2000)).toEqual([{ id: 's1' }])
    expect(readStartupCache('servers:u1', 1000 + 8 * 24 * 3600 * 1000)).toBeNull()
  })
  it('apaga tudo ao sair da conta', () => {
    writeStartupCache('servers:u1', [1])
    localStorage.setItem('outra-coisa', 'x')
    clearStartupCache()
    expect(readStartupCache('servers:u1')).toBeNull()
    expect(localStorage.getItem('outra-coisa')).toBe('x')
  })
})
