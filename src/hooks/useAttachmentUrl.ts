import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeHttpUrl } from '../lib/messageFormatting'
import { resolveAttachmentSource } from '../lib/storageRef'
import {
  SIGNED_URL_RENEW_MARGIN_MS,
  SUPABASE_URL,
  getCachedSignedUrl,
  getSignedUrl,
  invalidateSignedUrl,
} from '../lib/storageUrls'

// Intervalo mínimo entre duas tentativas "forçadas" (onError) — evita
// loop de pedidos se o arquivo não existe mais ou a permissão caiu.
const RETRY_COOLDOWN_MS = 30_000

interface Options {
  // Troca a URL sozinho antes de expirar. Desligue pra <audio>/<video>:
  // trocar o src no meio da reprodução reinicia o player — nesses, a
  // renovação acontece pelo onError (quando a URL velha já expirou).
  autoRenew?: boolean
}

// URL pronta pra usar em src/href de um anexo (file_url do banco).
// Gera URL assinada pros objetos do nosso Storage (buckets privados) e
// devolve URLs antigas do próprio projeto já filtradas por safeHttpUrl
// (URL de outro host nunca é carregada: `unavailable`). `onError`
// deve ir no onError do <img>/<audio>/<video>: força uma URL nova.
export function useAttachmentUrl(bucket: string, fileUrl: string | null | undefined, { autoRenew = true }: Options = {}) {
  const source = useMemo(() => resolveAttachmentSource(fileUrl, bucket, SUPABASE_URL), [fileUrl, bucket])
  const storageBucket = source?.kind === 'storage' ? source.bucket : null
  const storagePath = source?.kind === 'storage' ? source.path : null
  const key = storageBucket && storagePath ? `${storageBucket}\n${storagePath}` : null

  const [state, setState] = useState<{ key: string | null; url: string | null }>({ key: null, url: null })
  const [reloadToken, setReloadToken] = useState(0)
  const lastRetryRef = useRef(0)

  useEffect(() => {
    if (!storageBucket || !storagePath || !key) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      void getSignedUrl(storageBucket, storagePath).then((entry) => {
        if (cancelled) return
        setState({ key, url: entry?.url ?? null })
        if (entry && autoRenew) {
          const delay = Math.max(10_000, entry.expiresAt - SIGNED_URL_RENEW_MARGIN_MS - Date.now() + 1000)
          timer = setTimeout(load, delay)
        }
      })
    }
    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [storageBucket, storagePath, key, autoRenew, reloadToken])

  const onError = useCallback(() => {
    if (!storageBucket || !storagePath) return
    const now = Date.now()
    if (now - lastRetryRef.current < RETRY_COOLDOWN_MS) return
    lastRetryRef.current = now
    invalidateSignedUrl(storageBucket, storagePath)
    setReloadToken((t) => t + 1)
  }, [storageBucket, storagePath])

  let url: string | null = null
  if (source?.kind === 'external') url = source.url
  else if (source?.kind === 'storage') {
    url = state.key === key ? state.url : (getCachedSignedUrl(source.bucket, source.path)?.url ?? null)
  }
  // `unavailable`: URL de fora do nosso projeto — não carrega; a tela
  // mostra "anexo indisponível" (ver SignedAttachment).
  return { url: safeHttpUrl(url), onError, unavailable: source?.kind === 'unavailable' }
}
