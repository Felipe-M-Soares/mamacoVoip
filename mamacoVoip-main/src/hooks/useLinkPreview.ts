import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

export function useLinkPreview(url: string | null) {
  const [data, setData] = useState<LinkPreviewData | null>(url ? (cache.get(url) ?? null) : null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!url) {
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
        const value = error || !result ? null : result
        cache.set(url, value)
        setData(value)
      })
      .catch(() => {
        if (!cancelled) {
          cache.set(url, null)
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
