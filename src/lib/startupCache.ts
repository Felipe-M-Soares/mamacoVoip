// Cache da última lista de servidores/canais NESTE aparelho: ao abrir o
// app, a barra lateral aparece na hora com o que tinha da última vez e
// é atualizada por trás quando o servidor responde (antes ficava um
// esqueleto carregando a cada abertura). Separado por conta, apagado ao
// sair da conta e com validade de 7 dias.

const PREFIX = 'mv-cache:'
const VERSION = 1
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BYTES = 400_000

type Entry<T> = { v: number; at: number; data: T }

export function readStartupCache<T>(key: string, now = Date.now()): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const e = JSON.parse(raw) as Entry<T>
    if (e?.v !== VERSION || typeof e.at !== 'number' || now - e.at > MAX_AGE_MS) return null
    return e.data ?? null
  } catch {
    return null
  }
}

export function writeStartupCache<T>(key: string, data: T, now = Date.now()) {
  try {
    const raw = JSON.stringify({ v: VERSION, at: now, data } satisfies Entry<T>)
    if (raw.length > MAX_BYTES) return
    localStorage.setItem(PREFIX + key, raw)
  } catch {
    // sem espaço/bloqueado — só não guarda
  }
}

export function clearStartupCache() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // best-effort
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('mamacos:signed-out', clearStartupCache)
}
