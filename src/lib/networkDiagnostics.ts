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
  // Query string única por medição: garante uma entrada de Resource
  // Timing própria (antes pegava a última entrada com esse prefixo, que
  // podia ser de outra requisição do app) e evita cache no caminho.
  const url = `${SUPABASE_URL}/rest/v1/?diag=${Date.now()}-${Math.random().toString(36).slice(2)}`

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

  const matching = (performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[]).pop()

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
