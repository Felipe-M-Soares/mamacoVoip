// Diagnóstico de rede detalhado — em vez de só medir "quanto tempo levou
// no total" (que pode esconder onde o tempo realmente está sendo
// gasto), usa a API de Performance do navegador pra quebrar em: busca
// de DNS, conexão TCP, negociação TLS, e "tempo até o primeiro byte"
// (processamento do servidor + ida da rede). Isso separa "é rede
// mesmo" de "é alguma coisa específica lenta".
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface NetworkDiagnosticsResult {
  totalMs: number
  dnsMs: number | null
  tcpMs: number | null
  tlsMs: number | null
  ttfbMs: number | null
  region: string | null
}

export async function runNetworkDiagnostics(): Promise<NetworkDiagnosticsResult> {
  const url = `${SUPABASE_URL}/rest/v1/`
  const markStart = `mamacos-diag-start-${Date.now()}`
  performance.mark(markStart)

  const start = performance.now()
  let region: string | null = null
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    region = res.headers.get('x-sb-edge-region') ?? res.headers.get('cf-ray')?.split('-')[1] ?? null
  } catch {
    // segue mesmo se der erro — ainda queremos o tempo total
  }
  const totalMs = Math.round(performance.now() - start)

  // Espera um instante pra entrada de performance ficar disponível
  await new Promise((r) => setTimeout(r, 50))

  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const matching = entries.filter((e) => e.name.startsWith(url)).pop()

  let dnsMs: number | null = null
  let tcpMs: number | null = null
  let tlsMs: number | null = null
  let ttfbMs: number | null = null

  if (matching && matching.domainLookupStart > 0) {
    dnsMs = Math.round(matching.domainLookupEnd - matching.domainLookupStart)
    tcpMs = Math.round(matching.connectEnd - matching.connectStart)
    tlsMs = matching.secureConnectionStart > 0 ? Math.round(matching.connectEnd - matching.secureConnectionStart) : null
    ttfbMs = Math.round(matching.responseStart - matching.requestStart)
  }

  return { totalMs, dnsMs, tcpMs, tlsMs, ttfbMs, region }
}
