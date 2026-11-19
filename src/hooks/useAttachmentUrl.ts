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
import { getCachedAttachment, getMemoryAttachment } from '../lib/attachmentCache'

const RETRY_COOLDOWN_MS = 30_000

interface Options {
  autoRenew?: boolean
}

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
    const loadSigned = () => {
      void getSignedUrl(storageBucket, storagePath).then((entry) => {
        if (cancelled) return
        setState({ key, url: entry?.url ?? null })
        if (entry && autoRenew) {
          const delay = Math.max(10_000, entry.expiresAt - SIGNED_URL_RENEW_MARGIN_MS - Date.now() + 1000)
          timer = setTimeout(loadSigned, delay)
        }
      })
    }
    const load = () => {
      if (!autoRenew || reloadToken > 0) { loadSigned(); return }
      void getCachedAttachment(storageBucket, storagePath, () => getSignedUrl(storageBucket, storagePath).then((e) => e?.url ?? null)).then((res) => {
        if (cancelled) return
        if (res && res !== 'direct') setState({ key, url: res })
        else loadSigned()
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
    const mem = autoRenew ? getMemoryAttachment(source.bucket, source.path) : null
    url = state.key === key ? state.url : mem && mem !== 'direct' ? mem : (getCachedSignedUrl(source.bucket, source.path)?.url ?? null)
  }
  if (url && url.startsWith('blob:')) return { url, onError, unavailable: false }
  return { url: safeHttpUrl(url), onError, unavailable: source?.kind === 'unavailable' }
}
