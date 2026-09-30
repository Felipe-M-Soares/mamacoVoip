import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { safeHttpUrl } from '../lib/messageFormatting'

export interface LinkPreviewData {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string
}

// Cache simples em memória, compartilhado pelo app inteiro — evita
// buscar o preview de novo toda vez que a mensagem re-renderiza ou
// aparece de novo na tela (ex: rolar pra cima e pra baixo no chat).
const cache = new Map<string, LinkPreviewData | null>()
// Limite pra o cache não crescer sem fim numa sessão longa.
const MAX_CACHE_ENTRIES = 500

function remember(url: string, value: LinkPreviewData | null) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(url, value)
}

// Chamado no logout (AuthContext) — o cache é por aba, não por conta.
export function clearLinkPreviewCache() {
  cache.clear()
}

// O resultado vem de uma página qualquer da internet (via Edge
// Function) — nunca confia nele direto: o link e a imagem só passam se
// forem http(s) (um "javascript:" no href do card executaria código no
// app ao clicar), e os textos são limitados em tamanho.
function sanitizeLinkPreview(raw: unknown): LinkPreviewData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = safeHttpUrl(typeof r.url === 'string' ? r.url : null)
  if (!url) return null
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  return {
    url,
    title: text(r.title, 200),
    description: text(r.description, 300),
    image: safeHttpUrl(typeof r.image === 'string' ? r.image : null),
    siteName: text(r.siteName, 100) ?? new URL(url).hostname,
  }
}

export function useLinkPreview(url: string | null) {
  const [data, setData] = useState<LinkPreviewData | null>(url ? (cache.get(url) ?? null) : null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!url || !safeHttpUrl(url)) {
      setData(null)
      return
    }
    if (cache.has(url)) {
      setData(cache.get(url) ?? null)
      return
    }

    let cancelled = false
    setLoading(true)
    supabase.functions
      .invoke<LinkPreviewData>('link-preview', { body: { url } })
      .then(({ data: result, error }) => {
        if (cancelled) return
        const value = error || !result ? null : sanitizeLinkPreview(result)
        remember(url, value)
        setData(value)
      })
      .catch(() => {
        if (!cancelled) {
          remember(url, null)
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url])

  return { data, loading }
}
