const CACHE_NAME = 'mv-attachments-v1'
const MAX_BYTES = 25 * 1024 * 1024
const MAX_ENTRIES = 600
const TRIM_TO = 450

const memory = new Map<string, string | 'direct'>()
const inflight = new Map<string, Promise<string | 'direct' | null>>()

const supported = () => typeof caches !== 'undefined' && typeof URL.createObjectURL === 'function'
const cacheRequest = (bucket: string, path: string) =>
  new Request(`https://attachments.cache.local/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`)

export function getMemoryAttachment(bucket: string, path: string): string | 'direct' | null {
  return memory.get(`${bucket}\n${path}`) ?? null
}

async function trim(cache: Cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  await Promise.all(keys.slice(0, keys.length - TRIM_TO).map((k) => cache.delete(k)))
}

export function getCachedAttachment(bucket: string, path: string, sign: () => Promise<string | null>): Promise<string | 'direct' | null> {
  const key = `${bucket}\n${path}`
  const ready = memory.get(key)
  if (ready) return Promise.resolve(ready)
  if (!supported()) return Promise.resolve('direct')
  const running = inflight.get(key)
  if (running) return running
  const job = (async (): Promise<string | 'direct' | null> => {
    try {
      const cache = await caches.open(CACHE_NAME)
      const req = cacheRequest(bucket, path)
      const hit = await cache.match(req)
      if (hit) {
        const url = URL.createObjectURL(await hit.blob())
        memory.set(key, url)
        return url
      }
      const signed = await sign()
      if (!signed) return null
      const res = await fetch(signed)
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? ''
      const length = Number(res.headers.get('content-length') ?? 0)
      if (!type.startsWith('image/') || length > MAX_BYTES) {
        void res.body?.cancel().catch(() => {})
        memory.set(key, 'direct')
        return 'direct'
      }
      const blob = await res.blob()
      if (blob.size > MAX_BYTES) { memory.set(key, 'direct'); return 'direct' }
      const url = URL.createObjectURL(blob)
      memory.set(key, url)
      void cache.put(req, new Response(blob, { headers: { 'content-type': type } })).then(() => trim(cache)).catch(() => {})
      return url
    } catch {
      return 'direct'
    }
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

export function clearAttachmentCache() {
  for (const v of memory.values()) if (v !== 'direct') URL.revokeObjectURL(v)
  memory.clear()
  if (typeof caches !== 'undefined') void caches.delete(CACHE_NAME).catch(() => {})
}
