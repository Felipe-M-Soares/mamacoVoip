// Cache em disco das IMAGENS anexadas (Cache Storage do navegador/Electron).
//
// Por quê: os anexos ficam em bucket privado e são abertos por URL assinada,
// que muda a cada renovação (1h) e a cada vez que o app abre. Pro cache HTTP
// isso é "outro arquivo" — então toda imagem/GIF visível era baixada de novo
// de hora em hora e a cada abertura do app. Era isso que estourava a cota de
// saída (egress) do Supabase com pouquíssimos usuários.
//
// Agora cada imagem é baixada UMA vez, guardada pelo caminho no Storage (que
// não muda) e servida do disco por uma URL blob:. Só imagens até 25 MB entram;
// vídeo, áudio e outros arquivos continuam pela URL assinada direta (precisam
// de streaming) — e esses nunca foram renovados sozinhos.
// O cache é apagado ao sair da conta (clearAttachmentCache).

const CACHE_NAME = 'mv-attachments-v1'
const MAX_BYTES = 25 * 1024 * 1024
const MAX_ENTRIES = 600
const TRIM_TO = 450

// chave → URL blob: pronta, ou 'direct' (não é imagem / grande demais: use a URL assinada)
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
  // keys() vem na ordem de inserção: apaga as mais antigas
  await Promise.all(keys.slice(0, keys.length - TRIM_TO).map((k) => cache.delete(k)))
}

/**
 * URL blob: da imagem (do disco se já foi baixada; senão baixa uma vez com a
 * URL assinada dada por `sign` e guarda). 'direct' = não é imagem ou é grande
 * demais → quem chamou usa a URL assinada. null = falhou (sem acesso/rede).
 */
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
      // Cache Storage indisponível (modo privado, disco cheio…): segue pela URL assinada
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
