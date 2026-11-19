import { useEffect, useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

const PING_URL = `${SUPABASE_URL}/auth/v1/health?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}`

export function useConnectionPing() {
  const [pingMs, setPingMs] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let first = true

    async function measure() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      let best: number | null = null
      const rounds = first ? 3 : 1
      first = false
      for (let i = 0; i < rounds && !cancelled; i++) {
        const sample = await sampleOnce()
        if (sample !== null && (best === null || sample < best)) best = sample
      }
      if (!cancelled) setPingMs(best)
    }

    async function sampleOnce(): Promise<number | null> {
      const start = performance.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        const res = await fetch(PING_URL, { method: 'GET', signal: controller.signal, cache: 'no-store' })
        const elapsed = performance.now() - start
        void res.body?.cancel().catch(() => {})
        return Math.round(elapsed)
      } catch {
        return null
      } finally {
        clearTimeout(timeout)
      }
    }

    measure()
    const interval = setInterval(measure, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return pingMs
}
