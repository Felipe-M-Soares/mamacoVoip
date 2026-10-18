// Reconhece links de vídeo colados no chat (YouTube e clipes da Twitch)
// pra tocar o vídeo ali mesmo. Só aceita os formatos conhecidos — o resto
// continua virando a prévia de link normal.

export type VideoLink =
  | { provider: 'youtube'; id: string; start: number; shorts: boolean; url: string }
  | { provider: 'twitch-clip'; slug: string; url: string }

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
const TWITCH_SLUG = /^[A-Za-z0-9_-]{3,100}$/

/** "90", "90s", "1m30s", "1h2m3s" → segundos. */
export function parseYoutubeTime(value: string | null): number {
  if (!value) return 0
  const v = value.trim().toLowerCase()
  if (/^\d+s?$/.test(v)) return Math.min(parseInt(v, 10), 86_400)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v)
  if (!m || !(m[1] || m[2] || m[3])) return 0
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return Math.min(total, 86_400)
}

export function parseVideoLink(raw: string): VideoLink | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)

  // YouTube
  let id: string | null = null
  let shorts = false
  if (host === 'youtu.be') {
    id = parts[0] ?? null
  } else if (YT_HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v')
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') {
      id = parts[1] ?? null
      shorts = parts[0] === 'shorts'
    }
  }
  if (id && YT_ID.test(id)) {
    const start = parseYoutubeTime(u.searchParams.get('t') ?? u.searchParams.get('start'))
    return { provider: 'youtube', id, start, shorts, url: raw }
  }

  // Clipes da Twitch
  let slug: string | null = null
  if (host === 'clips.twitch.tv') slug = parts[0] ?? null
  else if ((host === 'twitch.tv' || host === 'www.twitch.tv' || host === 'm.twitch.tv') && parts[1] === 'clip') slug = parts[2] ?? null
  if (slug && TWITCH_SLUG.test(slug) && slug !== 'embed') return { provider: 'twitch-clip', slug, url: raw }

  return null
}

export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/**
 * Player oficial do YouTube (não o "nocookie": esse ignora o login, e aí
 * quem tem Premium no navegador veria anúncio). Só é carregado depois do
 * clique, então até lá o YouTube não sabe de nada.
 */
export function youtubeEmbedUrl(id: string, start: number): string {
  const p = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1' })
  if (start > 0) p.set('start', String(start))
  return `https://www.youtube.com/embed/${id}?${p.toString()}`
}

/** A Twitch exige o domínio de quem embute (`parent`) — só funciona no site. */
export function twitchClipEmbedUrl(slug: string, parent: string): string {
  const p = new URLSearchParams({ clip: slug, parent, autoplay: 'true' })
  return `https://clips.twitch.tv/embed?${p.toString()}`
}

export function canEmbedTwitch(loc: Pick<Location, 'protocol' | 'hostname'> = window.location): boolean {
  return loc.protocol === 'https:' && loc.hostname !== 'localhost' && loc.hostname.includes('.')
}

export function openOnSiteLabel(v: VideoLink): string {
  return v.provider === 'youtube' ? 'Abrir no YouTube' : 'Abrir na Twitch'
}
