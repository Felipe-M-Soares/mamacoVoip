import { describe, expect, it } from 'vitest'
import { categoryGame, gameIconSource, guessGameFromName } from './gameIcons'

describe('gameIcons', () => {
  it('reconhece os nomes das categorias', () => {
    expect(guessGameFromName('Rambo 6')).toBe('Rainbow Six Siege X')
    expect(guessGameFromName('Raibom Six')).toBe('Rainbow Six Siege X')
    expect(guessGameFromName('Valorant')).toBe('Valorant')
    expect(guessGameFromName('League das lendas')).toBe('League of Legends')
    expect(guessGameFromName('Battlefield')).toBe('Battlefield 6')
    expect(guessGameFromName('Valheim')).toBe('Valheim')
    expect(guessGameFromName('Delta')).toBe('Delta Force')
    expect(guessGameFromName('Letal company')).toBe('Lethal Company')
    expect(guessGameFromName('Anime')).toBeNull()
    expect(guessGameFromName('Geral')).toBeNull()
    expect(guessGameFromName('Música')).toBeNull()
  })
  it('respeita a escolha manual', () => {
    expect(categoryGame({ name: 'Anime', game: 'Genshin Impact' })).toBe('Genshin Impact')
    expect(categoryGame({ name: 'Valorant', game: '' })).toBeNull()
    expect(categoryGame({ name: 'Valorant', game: null })).toBe('Valorant')
  })
  it('acha imagem pra Steam e site oficial', () => {
    expect(gameIconSource('Rainbow Six Siege X')).toMatchObject({ kind: 'image' })
    expect(gameIconSource('Valorant')).toMatchObject({ kind: 'image' })
    expect(gameIconSource('Jogo Inventado')).toMatchObject({ kind: 'letter', letter: 'J' })
  })
})
