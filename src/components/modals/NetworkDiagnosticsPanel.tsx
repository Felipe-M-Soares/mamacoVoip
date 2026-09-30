import { useEffect, useRef, useState } from 'react'
import { runNetworkDiagnostics, type NetworkDiagnosticsResult } from '../../lib/networkDiagnostics'

export function NetworkDiagnosticsPanel() {
  const [result, setResult] = useState<NetworkDiagnosticsResult | null>(null)
  const [running, setRunning] = useState(false)
  const [samples, setSamples] = useState<number[]>([])
  // Fechar o modal no meio do "Testar 5x" continuava disparando
  // requisições e setState num componente já desmontado.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function runOnce() {
    setRunning(true)
    try {
      const r = await runNetworkDiagnostics()
      if (!mountedRef.current) return
      setResult(r)
      setSamples((prev) => [...prev.slice(-4), r.totalMs])
    } finally {
      if (mountedRef.current) setRunning(false)
    }
  }

  async function runFiveTimes() {
    setRunning(true)
    try {
      const times: number[] = []
      for (let i = 0; i < 5; i++) {
        if (!mountedRef.current) return
        const r = await runNetworkDiagnostics()
        if (!mountedRef.current) return
        times.push(r.totalMs)
        setResult(r)
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      if (mountedRef.current) setSamples(times)
    } finally {
      if (mountedRef.current) setRunning(false)
    }
  }

  const totalColor =
    result === null
      ? ''
      : result.totalMs < 250
        ? 'text-mv-green'
        : result.totalMs < 700
          ? 'text-amber-400'
          : 'text-rose-400'

  return (
    <div>
      <p className="field-label">Diagnóstico de rede</p>
      <p className="text-[12px] leading-snug text-mv-muted mb-3">
        Quebra o tempo de conexão em partes, pra ver exatamente onde ele está sendo gasto (DNS, conexão,
        segurança, ou resposta do servidor).
      </p>

      <div className="flex gap-2 mb-3">
        <button onClick={runOnce} disabled={running} className="flex-1 h-9 btn-secondary text-[13px]">
          Testar uma vez
        </button>
        <button
          onClick={runFiveTimes}
          disabled={running}
          aria-busy={running}
          className="flex-1 h-9 btn-primary text-[13px] flex items-center justify-center gap-2"
        >
          {running && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />}
          {running ? 'Testando...' : 'Testar 5x (mais preciso)'}
        </button>
      </div>

      {!result && running && (
        <div className="rounded-xl border border-[var(--color-line)] bg-mv-canvas p-3.5 space-y-2.5" aria-hidden>
          <div className="h-6 w-24 animate-pulse bg-white/[0.05] rounded" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-3 animate-pulse bg-white/[0.05] rounded" />
          ))}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-[var(--color-line)] bg-mv-canvas p-3.5 animate-fade-in" aria-live="polite">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-[12px] font-medium text-mv-muted">Tempo total</span>
            <span className={`font-display text-2xl font-semibold tabular-nums ${totalColor}`}>
              {result.totalMs}
              <span className="text-[13px] font-medium text-mv-muted ml-0.5">ms</span>
            </span>
          </div>
          <div className="space-y-2.5">
            <Row label="Busca de DNS" value={result.dnsMs} total={result.totalMs} />
            <Row label="Conexão (TCP)" value={result.tcpMs} total={result.totalMs} />
            <Row label="Segurança (TLS)" value={result.tlsMs} total={result.totalMs} />
            <Row label="Resposta do servidor (TTFB)" value={result.ttfbMs} total={result.totalMs} />
          </div>
          {(result.region || samples.length > 1) && (
            <div className="mt-3 pt-3 border-t border-[var(--color-line)] flex flex-wrap gap-1.5">
              {result.region && <span className="chip">Região: {result.region}</span>}
              {samples.length > 1 && (
                <span className="chip tabular-nums" title="Últimas medições">
                  Últimas: {samples.join('ms, ')}ms
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, total }: { label: string; value: number | null; total: number }) {
  const pct = value === null || total <= 0 ? 0 : Math.max(2, Math.min(100, (value / total) * 100))
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-mv-muted">{label}</span>
        <span className="text-mv-text font-medium tabular-nums">{value === null ? '—' : `${value}ms`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
