export function describeError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; hint?: unknown; details?: unknown }
    if (typeof e.message === 'string' && e.message) {
      const parts = [e.message]
      if (typeof e.code === 'string' && e.code) parts.push(`código: ${e.code}`)
      if (typeof e.hint === 'string' && e.hint) parts.push(`dica: ${e.hint}`)
      if (typeof e.details === 'string' && e.details) parts.push(e.details)
      return parts.join(' — ')
    }
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}
