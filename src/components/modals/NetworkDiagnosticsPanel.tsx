import { useState } from 'react'
import { runNetworkDiagnostics, type NetworkDiagnosticsResult } from '../../lib/networkDiagnostics'

export function NetworkDiagnosticsPanel() {
  const [result, setResult] = useState<NetworkDiagnosticsResult | null>(null)
  const [running, setRunning] = useState(false)
  const [samples, setSamples] = useState<number[]>([])

  async function runOnce() {
    setRunning(true)
    const r = await runNetworkDiagnostics()
    setResult(r)
    setSamples((prev) => [...prev.slice(-4), r.totalMs])
    setRunning(false)
  }

  async function runFiveTimes() {
    setRunning(true)
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = await runNetworkDiagnostics()
      times.push(r.totalMs)
      setResult(r)
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    setSamples(times)
    setRunning(false)
  }

  return (
    <div>
      <label className="block text-xs font-bold uppercase text-discord-text-muted mb-2">
        Diagnóstico de rede
      </label>
      <p className="text-[10px] text-discord-text-muted mb-2">
        Quebra o tempo de conexão em partes, pra ver exatamente onde ele está sendo gasto (DNS, conexão,
        segurança, ou resposta do servidor).
      </p>

      <div className="flex gap-2 mb-3">
        <button onClick={runOnce} disabled={running} className="flex-1 py-2 rounded btn-secondary text-xs disabled:opacity-60">
          Testar uma vez
        </button>
        <button onClick={runFiveTimes} disabled={running} className="flex-1 py-2 rounded btn-primary text-xs disabled:opacity-60">
          {running ? 'Testando...' : 'Testar 5x (mais preciso)'}
        </button>
      </div>

      {result && (
        <div className="bg-discord-darker rounded-lg p-3 space-y-1.5 text-xs font-mono">
          <Row label="Total" value={result.totalMs} highlight />
          <Row label="Busca de DNS" value={result.dnsMs} />
          <Row label="Conexão (TCP)" value={result.tcpMs} />
          <Row label="Segurança (TLS)" value={result.tlsMs} />
          <Row label="Resposta do servidor (TTFB)" value={result.ttfbMs} />
          {result.region && <p className="text-discord-text-muted pt-1 border-t border-white/5">Região: {result.region}</p>}
          {samples.length > 1 && (
            <p className="text-discord-text-muted pt-1 border-t border-white/5">
              Últimas medições: {samples.join('ms, ')}ms
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-discord-text-muted">{label}</span>
      <span className={highlight ? 'text-white font-bold' : 'text-discord-text'}>
        {value === null ? '—' : `${value}ms`}
      </span>
    </div>
  )
}
