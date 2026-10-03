import { describe, expect, it } from 'vitest'
import { chooseScreenCodec } from './hwEncode'

describe('chooseScreenCodec', () => {
  it('prefere H.264 por hardware', () => expect(chooseScreenCodec({ h264: true, vp9: true, av1: true }, true)).toBe('h264'))
  it('placa sem H.264 por hardware usa AV1', () => expect(chooseScreenCodec({ h264: false, vp9: true, av1: true }, true)).toBe('av1'))
  it('só VP9 por hardware usa VP9', () => expect(chooseScreenCodec({ h264: false, vp9: true, av1: false }, true)).toBe('vp9'))
  it('só AV1 por hardware usa AV1', () => expect(chooseScreenCodec({ h264: false, vp9: false, av1: true }, true)).toBe('av1'))
  it('nenhum por hardware: H.264 no processador', () => expect(chooseScreenCodec({ h264: false, vp9: false, av1: false }, true)).toBe('h264'))
  it('GPU desligada: sempre H.264', () => expect(chooseScreenCodec({ h264: false, vp9: true, av1: true }, false)).toBe('h264'))
})
