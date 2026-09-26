import { describe, it, expect, beforeEach } from 'vitest'
import { isPinned, togglePinned, getPinnedSet, getUserNote, setUserNote } from './pinnedItems'

beforeEach(() => {
  localStorage.clear()
})

describe('fixar itens (isPinned/togglePinned/getPinnedSet)', () => {
  it('começa sem nada fixado', () => {
    expect(isPinned('canal-1')).toBe(false)
    expect(getPinnedSet().size).toBe(0)
  })

  it('fixa e desafixa alternando a cada chamada', () => {
    expect(togglePinned('canal-1')).toBe(true)
    expect(isPinned('canal-1')).toBe(true)

    expect(togglePinned('canal-1')).toBe(false)
    expect(isPinned('canal-1')).toBe(false)
  })

  it('mantém vários itens fixados independentes', () => {
    togglePinned('canal-1')
    togglePinned('canal-2')
    const set = getPinnedSet()
    expect(set.has('canal-1')).toBe(true)
    expect(set.has('canal-2')).toBe(true)
    expect(set.size).toBe(2)
  })
})

describe('notas de usuário (getUserNote/setUserNote)', () => {
  it('começa vazia', () => {
    expect(getUserNote('user-1')).toBe('')
  })

  it('salva e recupera uma nota, removendo espaços nas pontas', () => {
    setUserNote('user-1', '  gosta de RPG  ')
    expect(getUserNote('user-1')).toBe('gosta de RPG')
  })

  it('remove a nota quando salva uma string vazia/só espaços', () => {
    setUserNote('user-1', 'nota qualquer')
    setUserNote('user-1', '   ')
    expect(getUserNote('user-1')).toBe('')
  })

  it('mantém notas de usuários diferentes separadas', () => {
    setUserNote('user-1', 'nota do 1')
    setUserNote('user-2', 'nota do 2')
    expect(getUserNote('user-1')).toBe('nota do 1')
    expect(getUserNote('user-2')).toBe('nota do 2')
  })
})
