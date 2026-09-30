import { describe, it, expect, beforeEach } from 'vitest'
import {
  STICKERS,
  describeMessageContent,
  getRecentStickers,
  getSticker,
  parseStickerId,
  pushRecentSticker,
  searchStickers,
  stickerMessage,
} from './stickers'

describe('stickers', () => {
  beforeEach(() => localStorage.clear())

  it('carrega o pacote inteiro com URL pra cada figurinha', () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(24)
    for (const s of STICKERS) expect(s.url).toBeTruthy()
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length)
  })

  it('ida e volta do formato de mensagem', () => {
    expect(parseStickerId(stickerMessage('gg'))).toBe('gg')
    expect(parseStickerId('[[sticker:GG]]')).toBeNull()
    expect(parseStickerId('[[sticker:gg]] oi')).toBeNull()
    expect(parseStickerId('[[sticker:]]')).toBeNull()
    expect(parseStickerId('[[sticker:a"onerror=x]]')).toBeNull()
  })

  it('descreve figurinha pra notificações', () => {
    expect(describeMessageContent('[[sticker:coracao]]')).toBe('[Figurinha: Coração]')
    expect(describeMessageContent('[[sticker:xyz]]')).toBe('[Figurinha]')
    expect(describeMessageContent('texto normal')).toBe('texto normal')
  })

  it('busca por nome, id e tags, sem acento', () => {
    expect(searchStickers('trofeu').map((s) => s.id)).toContain('trofeu')
    expect(searchStickers('kkk').map((s) => s.id)).toContain('rindo')
    expect(searchStickers('macaco').length).toBe(4)
    expect(searchStickers('').length).toBe(STICKERS.length)
  })

  it('guarda recentes sem duplicar, mais novo primeiro', () => {
    pushRecentSticker('gg')
    pushRecentSticker('ez')
    pushRecentSticker('gg')
    expect(getRecentStickers().map((s) => s.id)).toEqual(['gg', 'ez'])
    expect(getSticker('gg')?.label).toBe('GG')
  })
})
