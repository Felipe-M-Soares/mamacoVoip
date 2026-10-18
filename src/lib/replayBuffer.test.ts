import { describe, expect, it } from 'vitest'
import { clipFileName, pickOldestSegment, pickRecorderFormat } from './replayBuffer'

describe('replayBuffer', () => {
  it('prefere MP4 e cai pra WebM', () => {
    expect(pickRecorderFormat((m) => m.startsWith('video/mp4'))?.ext).toBe('mp4')
    expect(pickRecorderFormat((m) => m === 'video/webm;codecs=vp9,opus')).toEqual({ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' })
    expect(pickRecorderFormat(() => false)).toBeNull()
  })
  it('usa o segmento mais antigo', () => {
    expect(pickOldestSegment([{ startedAt: 30 }, { startedAt: 10 }, { startedAt: 20 }])).toEqual({ startedAt: 10 })
    expect(pickOldestSegment([])).toBeNull()
  })
  it('gera nome de arquivo seguro', () => {
    const d = new Date(2026, 9, 11, 9, 5, 3)
    expect(clipFileName('João da Silva!', 'mp4', d)).toBe('mamacos-clipe_Joao-da-Silva_2026-10-11_09-05-03.mp4')
    expect(clipFileName('***', 'webm', d)).toBe('mamacos-clipe_transmissao_2026-10-11_09-05-03.webm')
  })
})
