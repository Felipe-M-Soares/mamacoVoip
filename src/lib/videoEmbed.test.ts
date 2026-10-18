import { describe, expect, it } from 'vitest'
import { canEmbedTwitch, parseVideoLink, parseYoutubeTime, youtubeEmbedUrl } from './videoEmbed'

describe('parseVideoLink', () => {
  it('reconhece os formatos do YouTube', () => {
    expect(parseVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ provider: 'youtube', id: 'dQw4w9WgXcQ', start: 0 })
    expect(parseVideoLink('https://youtu.be/dQw4w9WgXcQ?t=90')).toMatchObject({ id: 'dQw4w9WgXcQ', start: 90 })
    expect(parseVideoLink('https://youtube.com/shorts/abcdefghijk')).toMatchObject({ id: 'abcdefghijk', shorts: true })
    expect(parseVideoLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toMatchObject({ start: 90 })
    expect(parseVideoLink('https://www.youtube.com/live/dQw4w9WgXcQ')).toMatchObject({ id: 'dQw4w9WgXcQ' })
  })
  it('reconhece clipes da Twitch', () => {
    expect(parseVideoLink('https://clips.twitch.tv/FunnyClipSlug-abc123')).toMatchObject({ provider: 'twitch-clip', slug: 'FunnyClipSlug-abc123' })
    expect(parseVideoLink('https://www.twitch.tv/gaules/clip/SomeSlug_1')).toMatchObject({ slug: 'SomeSlug_1' })
  })
  it('ignora o resto', () => {
    expect(parseVideoLink('https://www.youtube.com/@canal')).toBeNull()
    expect(parseVideoLink('https://www.youtube.com/watch?v=curto')).toBeNull()
    expect(parseVideoLink('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseVideoLink('javascript:alert(1)')).toBeNull()
    expect(parseVideoLink('https://www.twitch.tv/gaules')).toBeNull()
  })
  it('converte tempo e monta o player', () => {
    expect(parseYoutubeTime('1h2m3s')).toBe(3723)
    expect(parseYoutubeTime('abc')).toBe(0)
    expect(youtubeEmbedUrl('dQw4w9WgXcQ', 30)).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1&start=30')
    expect(canEmbedTwitch({ protocol: 'app:', hostname: 'bundle' })).toBe(false)
    expect(canEmbedTwitch({ protocol: 'https:', hostname: 'mamaco-voip.vercel.app' })).toBe(true)
  })
})
