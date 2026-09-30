import { supabase } from './supabase'
import { storagePathsForBucket } from './storageRef'

// URLs assinadas dos anexos (buckets privados desde a migration 017).
//
// - Cada URL vale SIGNED_URL_TTL_SECONDS (1h). Quem exibe (useAttachmentUrl)
//   pede de novo um pouco antes de expirar.
// - Cache em memória por bucket+caminho: a mesma imagem aparecendo em
//   vários lugares (ou a lista re-renderizando) não gera pedido novo.
// - Pedidos que chegam juntos (uma conversa inteira abrindo) são
//   agrupados por bucket num único createSignedUrls.
// Nada disso fica salvo em disco — ao sair da conta o cache é limpo
// (clearSignedUrlCache, chamado pelo AuthContext).

const SIGNED_URL_TTL_SECONDS = 60 * 60
// Renova quando faltar menos que isso pra expirar.
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
}

async function flush() {
  flushScheduled = false
  const batches = [...pending.entries()]
  pending.clear()
  for (const [bucket, byPath] of batches) {
    const paths = [...byPath.keys()]
    // Momento do pedido (não da resposta) — assim a expiração local
    // nunca fica DEPOIS da real.
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

// URL assinada (do cache se ainda estiver boa). null = sem permissão,
// objeto não existe mais, ou falha de rede.
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

// Apaga do Storage os arquivos dos anexos de uma mensagem que acabou de
// ser excluída. Best-effort: se falhar (sem permissão, rede), a
// mensagem continua apagada e o arquivo fica órfão — por isso uma
// limpeza periódica no servidor é recomendada (ver
// supabase/migrations/007_seguranca_e_recursos_2026.sql, parte 017). Com o bucket
// privado, um arquivo órfão já não é acessível por ninguém de fora.
export async function removeAttachmentObjects(bucket: string, fileUrls: Array<string | null | undefined>) {
  const paths = storagePathsForBucket(fileUrls, bucket, SUPABASE_URL)
  if (paths.length === 0) return
  for (const path of paths) invalidateSignedUrl(bucket, path)
  try {
    await supabase.storage.from(bucket).remove(paths)
  } catch {
    // best-effort
  }
}
