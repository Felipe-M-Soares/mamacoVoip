const hits = new Map<string, number[]>()

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const cutoff = now - windowMs
  const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff)

  if (timestamps.length >= max) {
    hits.set(key, timestamps)
    const retryAfterMs = timestamps[0] + windowMs - now
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }

  timestamps.push(now)
  hits.set(key, timestamps)
  return { allowed: true, retryAfterSeconds: 0 }
}

export function rateLimitError(key: string, max: number, windowMs: number, what: string): string | null {
  const result = checkRateLimit(key, max, windowMs)
  if (result.allowed) return null
  return `Calma aí — ${what} rápido demais. Espera ${result.retryAfterSeconds}s e tenta de novo.`
}
