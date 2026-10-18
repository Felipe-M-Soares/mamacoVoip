// Edge Function: gif-search
//
// Busca de GIFs do chat pela API do KLIPY (substituto gratuito do Tenor).
// Passa por aqui (e não direto do app) por dois motivos:
//   - a chave do KLIPY fica SÓ no servidor (secret KLIPY_API_KEY no
//     Supabase) — antes a chave do GIPHY ia dentro do app, legível por
//     qualquer um;
//   - quem pesquisa não tem o IP nem o texto ligados à própria conta no
//     KLIPY: o KLIPY recebe só um id anônimo (hash do usuário).
// Só aceita usuário logado de verdade e limita as buscas por pessoa.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const KLIPY_BASE = 'https://api.klipy.com/api/v1'
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 40
const TIMEOUT_MS = 6000

const hits = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const list = (hits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  list.push(now)
  hits.set(userId, list)
  if (hits.size > 5000) hits.clear()
  return list.length > RATE_LIMIT_MAX
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function anonymousId(userId: string): Promise<string> {
  const salt = Deno.env.get('KLIPY_API_KEY') ?? ''
  const data = new TextEncoder().encode(`${salt}:${userId}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Variant = { gif?: { url?: string }; webp?: { url?: string } }
type KlipyItem = { id?: number | string; slug?: string; type?: string; file?: Record<string, Variant> }

function pick(item: KlipyItem, order: string[]): string | null {
  for (const q of order) {
    const v = item.file?.[q]
    const url = v?.gif?.url ?? v?.webp?.url
    if (typeof url === 'string' && url.startsWith('https://')) return url
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const apiKey = Deno.env.get('KLIPY_API_KEY')
    if (!apiKey) return json({ error: 'not_configured' }, 503)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autenticado' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) return json({ error: 'Sessão inválida ou expirada' }, 401)
    if (rateLimited(user.id)) return json({ error: 'Muitas buscas. Espere um pouquinho.' }, 429)

    const body = await req.json().catch(() => ({}))
    const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 100) : ''
    const page = Number.isInteger(body?.page) && body.page > 0 && body.page < 50 ? body.page : 1
    const adult = body?.adult === true

    const url = new URL(`${KLIPY_BASE}/${encodeURIComponent(apiKey)}/gifs/${q ? 'search' : 'trending'}`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', '24')
    url.searchParams.set('customer_id', await anonymousId(user.id))
    url.searchParams.set('locale', 'pt_BR')
    url.searchParams.set('format_filter', 'gif')
    url.searchParams.set('rating', adult ? 'r' : 'pg-13')
    url.searchParams.set('content_filter', adult ? 'low' : 'medium')
    if (q) url.searchParams.set('q', q)

    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    } finally {
      clearTimeout(t)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.result) {
      console.error('KLIPY erro', res.status, JSON.stringify(data?.errors ?? null).slice(0, 300))
      return json({ error: 'upstream' }, 502)
    }

    const items: KlipyItem[] = Array.isArray(data?.data?.data) ? data.data.data : []
    const gifs = items
      .filter((it) => it?.type !== 'ad')
      .map((it) => {
        const full = pick(it, ['md', 'hd', 'sm', 'xs'])
        const preview = pick(it, ['sm', 'xs', 'md', 'hd'])
        return full && preview ? { id: String(it.slug ?? it.id), url: full, previewUrl: preview } : null
      })
      .filter(Boolean)

    return json({ gifs, hasNext: Boolean(data?.data?.has_next) })
  } catch (err) {
    console.error('gif-search falhou', err instanceof Error ? err.message : String(err))
    return json({ error: 'internal' }, 500)
  }
})
