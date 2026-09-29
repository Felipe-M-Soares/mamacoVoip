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
      // Janela minimizada/em segundo plano: não gasta rede/CPU medindo
      // um número que ninguém está olhando (e que o Chromium distorce de
      // qualquer jeito, já que ele atrasa timers de abas em background).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const start = performance.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD', signal: controller.signal, cache: 'no-store' })
        if (!cancelled) setPingMs(Math.round(performance.now() - start))
      } catch {
        if (!cancelled) setPingMs(null)
      } finally {
        // Antes só era limpo no caminho de sucesso — num erro de rede o
        // timer continuava pendurado até disparar.
        clearTimeout(timeout)
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
