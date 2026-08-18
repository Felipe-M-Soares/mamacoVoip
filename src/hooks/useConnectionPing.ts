import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useConnectionPing() {
  const [pingMs, setPingMs] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function measure() {
      const start = performance.now()
      try {
        await supabase.from('profiles').select('id').limit(1)
        if (!cancelled) setPingMs(Math.round(performance.now() - start))
      } catch {
        if (!cancelled) setPingMs(null)
      }
    }

    measure()
    const interval = setInterval(measure, 15_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return pingMs
}
