import { useEffect, useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export function useConnectionPing() {
  const [pingMs, setPingMs] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function measure() {
      // Antes isso fazia uma consulta completa no banco (select numa
      // tabela) — só que isso mede o tempo de processar a query
      // inteira (parse, permissão RLS, serializar resposta), não a
      // latência de rede de verdade, e por isso aparecia um "ping"
      // bem mais alto do que a conexão real. Um HEAD simples na raiz
      // da API mede só o vai-e-volta da rede, sem tocar no banco.
      const start = performance.now()
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD', signal: controller.signal })
        clearTimeout(timeout)
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
