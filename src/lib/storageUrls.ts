import { supabase } from './supabase'
import { storagePathsForBucket } from './storageRef'
import { clearAttachmentCache } from './attachmentCache'

const SIGNED_URL_TTL_SECONDS = 60 * 60
export const SIGNED_URL_RENEW_MARGIN_MS = 5 * 60 * 1000

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface SignedUrlEntry {
  url: string
  expiresAt: number
}

const cache = new Map<string, SignedUrlEntry>()
const inflight = new Map<string, Promise<SignedUrlEntry | null>>()
type Waiter = { resolve: (entry: SignedUrlEntry | null) => void }
const pending = new Map<string, Map<string, Waiter[]>>()
let flushScheduled = false

function cacheKey(bucket: string, path: string) {
  return `${bucket}\n${path}`
}

export function getCachedSignedUrl(bucket: string, path: string): SignedUrlEntry | null {
  const entry = cache.get(cacheKey(bucket, path))
  if (!entry) return null
  if (entry.expiresAt - Date.now() <= SIGNED_URL_RENEW_MARGIN_MS) return null
  return entry
}

export function invalidateSignedUrl(bucket: string, path: string) {
  cache.delete(cacheKey(bucket, path))
}

export function clearSignedUrlCache() {
  cache.clear()
  clearAttachmentCache()
}

async function flush() {
  flushScheduled = false
  const batches = [...pending.entries()]
  pending.clear()
  for (const [bucket, byPath] of batches) {
    const paths = [...byPath.keys()]
    const requestedAt = Date.now()
    let results: Array<{ path: string | null; signedUrl: string | null; error: string | null }> = []
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
      if (!error && data) results = data
    } catch {
      results = []
    }
    const byResultPath = new Map(results.filter((r) => r.path && r.signedUrl && !r.error).map((r) => [r.path as string, r.signedUrl as string]))
    for (const [path, waiters] of byPath) {
      const url = byResultPath.get(path)
      const entry = url ? { url, expiresAt: requestedAt + SIGNED_URL_TTL_SECONDS * 1000 } : null
      if (entry) cache.set(cacheKey(bucket, path), entry)
      for (const w of waiters) w.resolve(entry)
    }
  }
}

export function getSignedUrl(bucket: string, path: string): Promise<SignedUrlEntry | null> {
  const cached = getCachedSignedUrl(bucket, path)
  if (cached) return Promise.resolve(cached)
  const key = cacheKey(bucket, path)
  const running = inflight.get(key)
  if (running) return running
  const promise = new Promise<SignedUrlEntry | null>((resolve) => {
    let byPath = pending.get(bucket)
    if (!byPath) {
      byPath = new Map()
      pending.set(bucket, byPath)
    }
    const waiters = byPath.get(path) ?? []
    waiters.push({ resolve })
    byPath.set(path, waiters)
    if (!flushScheduled) {
      flushScheduled = true
      setTimeout(() => void flush(), 0)
    }
  }).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

export async function removeAttachmentObjects(bucket: string, fileUrls: Array<string | null | undefined>) {
  const paths = storagePathsForBucket(fileUrls, bucket, SUPABASE_URL)
  if (paths.length === 0) return
  for (const path of paths) invalidateSignedUrl(bucket, path)
  try {
    await supabase.storage.from(bucket).remove(paths)
  } catch {
  }
}
