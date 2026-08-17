// Edge Function: link-preview
//
// Busca uma URL do lado do servidor e extrai as tags Open Graph/meta
// (título, descrição, imagem) pra mostrar um preview de link no chat.
// Isso NÃO dá pra fazer direto do navegador/app por causa de CORS —
// a maioria dos sites não libera esse tipo de acesso vindo de outro
// domínio, então precisa passar por um servidor nosso.
//
// Segurança: como isso aceita qualquer URL que o usuário colar no
// chat, tem proteção contra SSRF (Server-Side Request Forgery) —
// bloqueia tentativas de buscar endereços internos/privados (ex:
// localhost, rede interna, endpoint de metadados de nuvem), timeout
// curto, e lê só os primeiros ~150KB da resposta (o <head> com as
// tags que precisamos está sempre bem no início).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.local') || lower === '0.0.0.0') return true

  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 127) return true // loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // link-local / metadados de nuvem
    if (a === 0) return true
  }

  if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  return false
}

function extractMeta(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('URL ausente ou inválida')
    }

    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Só http/https são permitidos')
    }
    if (isPrivateHost(parsed.hostname)) {
      throw new Error('Esse endereço não pode ser buscado')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    let res: Response
    try {
      res = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MamacosVoipLinkPreview/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!res.ok) throw new Error(`Falha ao buscar a página (${res.status})`)

    const finalUrl = new URL(res.url)
    if (isPrivateHost(finalUrl.hostname)) {
      throw new Error('Redirecionamento pra um endereço não permitido')
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      return new Response(
        JSON.stringify({ url: finalUrl.toString(), title: null, description: null, image: null, siteName: finalUrl.hostname }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Lê só um pedaço da resposta — as tags que precisamos ficam no
    // <head>, sempre no começo do HTML, não precisa (nem é seguro)
    // baixar a página inteira.
    const MAX_BYTES = 150_000
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
      }
      reader.cancel().catch(() => {})
    }

    const title = extractMeta(html, 'og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null
    const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description')
    const rawImage = extractMeta(html, 'og:image')
    const siteName = extractMeta(html, 'og:site_name')

    let image: string | null = null
    if (rawImage) {
      try {
        const imageUrl = new URL(rawImage, finalUrl)
        if (!isPrivateHost(imageUrl.hostname)) image = imageUrl.toString()
      } catch {
        // URL de imagem inválida — ignora, segue sem imagem
      }
    }

    return new Response(
      JSON.stringify({
        url: finalUrl.toString(),
        title: decodeEntities(title)?.trim().slice(0, 200) ?? null,
        description: decodeEntities(description)?.trim().slice(0, 300) ?? null,
        image,
        siteName: decodeEntities(siteName)?.trim().slice(0, 100) ?? finalUrl.hostname,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
