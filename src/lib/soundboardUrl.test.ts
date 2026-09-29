import { describe, it, expect } from 'vitest'
import { isAllowedSoundboardUrl } from './soundboardUrl'

const BASE = 'https://abc.supabase.co'

describe('isAllowedSoundboardUrl', () => {
  it('aceita URL pública do bucket soundboard', () => {
    expect(isAllowedSoundboardUrl(`${BASE}/storage/v1/object/public/soundboard/srv/som.mp3`, BASE)).toBe(true)
    expect(isAllowedSoundboardUrl(`${BASE}/storage/v1/object/public/soundboard/srv/som.mp3`, `${BASE}/`)).toBe(true)
  })
  it('recusa outros domínios, outros buckets e lixo', () => {
    expect(isAllowedSoundboardUrl('https://evil.example/x.mp3', BASE)).toBe(false)
    expect(isAllowedSoundboardUrl(`${BASE}/storage/v1/object/public/avatars/a.png`, BASE)).toBe(false)
    expect(isAllowedSoundboardUrl(`${BASE}/storage/v1/object/public/soundboard/../avatars/a.png`, BASE)).toBe(false)
    expect(isAllowedSoundboardUrl(42, BASE)).toBe(false)
    expect(isAllowedSoundboardUrl(`${BASE}/storage/v1/object/public/soundboard/x`, '')).toBe(false)
  })
})
