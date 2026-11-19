import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_URL_LENGTH = 2048
const MAX_BYTES = 150_000
const TOTAL_TIMEOUT_MS = 6000
const MAX_REDIRECTS = 3
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

class PublicError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function parseIPv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return null
  return parts
}

function isPrivateIPv4(parts: number[]): boolean {
  const [a, b, c] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  if (a === 192 && b === 88 && c === 99) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}

function parseIPv6(host: string): number[] | null {
  let h = host.toLowerCase()
  const zoneIdx = h.indexOf('%')
  if (zoneIdx !== -1) h = h.slice(0, zoneIdx)
  if (!h.includes(':')) return null

  const lastColon = h.lastIndexOf(':')
  const tail = h.slice(lastColon + 1)
  let tailGroups: number[] = []
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail)
    if (!v4) return null
    tailGroups = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    h = h.slice(0, lastColon + 1) + '0:0'
  }

  const halves = h.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string) => (s === '' ? [] : s.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)))
  const left = toGroups(halves[0])
  const right = halves.length === 2 ? toGroups(halves[1]) : []
  if ([...left, ...right].some((n) => Number.isNaN(n))) return null

  let groups: number[]
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 0) return null
    groups = [...left, ...new Array(missing).fill(0), ...right]
  } else {
    groups = left
  }
  if (groups.length !== 8) return null
  if (tailGroups.length === 2) {
    groups[6] = tailGroups[0]
    groups[7] = tailGroups[1]
  }
  return groups
}

function isPrivateIPv6(g: number[]): boolean {
  if (g.every((x) => x === 0)) return true
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPrivateIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff])
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff])
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true
  if ((g[0] & 0xffc0) === 0xfe80) return true
  if ((g[0] & 0xffc0) === 0xfec0) return true
  if ((g[0] & 0xff00) === 0xff00) return true
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true
  if (g[0] === 0x2002) {
    return isPrivateIPv4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff])
  }
  return false
}

export function isPrivateAddress(address: string): boolean {
  const v4 = parseIPv4(address)
  if (v4) return isPrivateIPv4(v4)
  const v6 = parseIPv6(address)
  if (v6) return isPrivateIPv6(v6)
  return false
}

function isBlockedHostname(hostname: string): boolean {
  let lower = hostname.toLowerCase().replace(/\.$/, '')
  if (lower.startsWith('[') && lower.endsWith(']')) lower = lower.slice(1, -1)
  if (lower === '' || lower === 'localhost' || lower.endsWith('.localhost')) return true
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.lan') || lower.endsWith('.home.arpa')) return true
  if (lower === 'metadata.google.internal' || lower === 'metadata') return true
  if (parseIPv4(lower) || parseIPv6(lower)) return isPrivateAddress(lower)
  if (!lower.includes('.')) return true
  return false
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isBlockedHostname(hostname)) throw new PublicError('Esse endereço não pode ser buscado')

  let lower = hostname.toLowerCase()
  if (lower.startsWith('[')) return
  if (parseIPv4(lower)) return
  lower = lower.replace(/\.$/, '')

  const resolveDns = (Deno as unknown as { resolveDns?: (h: string, t: string) => Promise<string[]> }).resolveDns
  if (typeof resolveDns !== 'function') throw new PublicError('Pré-visualização indisponível no momento')
  const results = await Promise.allSettled([resolveDns(lower, 'A'), resolveDns(lower, 'AAAA')])
  const addresses = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (addresses.length === 0) throw new PublicError('Não foi possível resolver esse endereço')
  if (addresses.some((addr) => isPrivateAddress(addr))) {
    throw new PublicError('Esse endereço não pode ser buscado')
  }
}

function validateUrl(raw: string, base?: URL): URL {
  let parsed: URL
  try {
    parsed = base ? new URL(raw, base) : new URL(raw)
  } catch {
    throw new PublicError('URL inválida')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PublicError('Só http/https são permitidos')
  }
  if (parsed.username || parsed.password) throw new PublicError('URL com credenciais não é permitida')
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    throw new PublicError('Porta não permitida')
  }
  return parsed
}

function extractMeta(html: string, prop: string): string | null {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ]
  for (const re of patterns) {
    const match = html.match(re)
    if (match) return match[1]
  }
  return null
}

function decodeEntities(s: string | null): string | null {
  if (!s) return s
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return ''
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

function cleanText(s: string | null, max: number): string | null {
  const decoded = decodeEntities(s)
  if (!decoded) return null
  // eslint-disable-next-line no-control-regex
  const cleaned = decoded.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

const hits = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(userId, recent)
    return true
  }
  recent.push(now)
  hits.set(userId, recent)
  if (hits.size > 5000) hits.clear()
  return false
}

async function fetchWithSafeRedirects(start: URL, signal: AbortSignal): Promise<{ res: Response; finalUrl: URL }> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname)
    const res = await fetch(current.toString(), {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MamacosVoipLinkPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      res.body?.cancel().catch(() => {})
      if (!location) throw new PublicError('Redirecionamento inválido')
      current = validateUrl(location, current)
      continue
    }
    return { res, finalUrl: current }
  }
  throw new PublicError('Redirecionamentos demais')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido' }, 405)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new PublicError('Não autenticado', 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnonKey) throw new PublicError('Configuração ausente no servidor', 500)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) throw new PublicError('Sessão inválida ou expirada', 401)

    if (rateLimited(user.id)) throw new PublicError('Muitas requisições. Tente de novo em instantes.', 429)

    const body = await req.json().catch(() => null)
    const url = body && typeof body.url === 'string' ? body.url.trim() : ''
    if (!url || url.length > MAX_URL_LENGTH) throw new PublicError('URL ausente ou inválida')

    const parsed = validateUrl(url)
    const { res, finalUrl } = await fetchWithSafeRedirects(parsed, controller.signal)

    if (!res.ok) {
      res.body?.cancel().catch(() => {})
      throw new PublicError(`Falha ao buscar a página (${res.status})`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      res.body?.cancel().catch(() => {})
      return jsonResponse({ url: finalUrl.toString(), title: null, description: null, image: null, siteName: finalUrl.hostname })
    }

    const reader = res.body?.getReader()
    let html = ''
    if (reader) {
      const decoder = new TextDecoder()
      let bytesRead = 0
      while (bytesRead < MAX_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        bytesRead += value.length
        html += decoder.decode(value, { stream: true })
        if (/<\/head>/i.test(html)) break
      }
      reader.cancel().catch(() => {})
    }
    html = html.slice(0, MAX_BYTES)

    const title = extractMeta(html, 'og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null
    const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description')
    const rawImage = extractMeta(html, 'og:image')
    const siteName = extractMeta(html, 'og:site_name')

    let image: string | null = null
    if (rawImage) {
      try {
        const imageUrl = new URL(decodeEntities(rawImage) ?? rawImage, finalUrl)
        if (
          (imageUrl.protocol === 'https:' || imageUrl.protocol === 'http:') &&
          !imageUrl.username &&
          !isBlockedHostname(imageUrl.hostname) &&
          imageUrl.toString().length <= MAX_URL_LENGTH
        ) {
          image = imageUrl.toString()
        }
      } catch {
      }
    }

    return jsonResponse({
      url: finalUrl.toString(),
      title: cleanText(title, 200),
      description: cleanText(description, 300),
      image,
      siteName: cleanText(siteName, 100) ?? finalUrl.hostname,
    })
  } catch (err) {
    if (err instanceof PublicError) return jsonResponse({ error: err.message }, err.status)
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    return jsonResponse({ error: aborted ? 'Tempo esgotado ao buscar a página' : 'Não foi possível gerar o preview' }, 400)
  } finally {
    clearTimeout(timeoutId)
  }
})
