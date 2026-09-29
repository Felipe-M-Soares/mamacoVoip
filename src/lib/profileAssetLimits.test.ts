import { describe, it, expect } from 'vitest'
import { sniffImageMime, validateProfileAssetDeep, AVATAR_ACCEPT, DECORATION_ACCEPT } from './profileAssetLimits'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

function fileOf(bytes: number[], type: string) {
  return new File([new Uint8Array(bytes)], 'x', { type })
}

describe('sniffImageMime', () => {
  it('reconhece as assinaturas', () => {
    expect(sniffImageMime(new Uint8Array(PNG))).toBe('image/png')
    expect(sniffImageMime(new Uint8Array(JPG))).toBe('image/jpeg')
    expect(sniffImageMime(new Uint8Array(GIF))).toBe('image/gif')
    expect(sniffImageMime(new Uint8Array(WEBP))).toBe('image/webp')
    expect(sniffImageMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })
})

describe('validateProfileAssetDeep', () => {
  it('aceita imagem real', async () => {
    expect(await validateProfileAssetDeep(fileOf(PNG, 'image/png'), 1024, AVATAR_ACCEPT)).toBeNull()
  })
  it('recusa HTML disfarçado de PNG', async () => {
    const f = new File(['<html><script>alert(1)</script></html>'], 'a.png', { type: 'image/png' })
    expect(await validateProfileAssetDeep(f, 1024, AVATAR_ACCEPT)).toMatch(/não é uma imagem/)
  })
  it('recusa JPEG real na decoração', async () => {
    expect(await validateProfileAssetDeep(fileOf(JPG, 'image/png'), 1024, DECORATION_ACCEPT)).not.toBeNull()
  })
  it('recusa arquivo grande demais', async () => {
    expect(await validateProfileAssetDeep(fileOf(PNG, 'image/png'), 4, AVATAR_ACCEPT)).toMatch(/grande/)
  })
})
