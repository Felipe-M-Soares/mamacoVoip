// Ping REAL da call: ida-e-volta (RTT) medida pelo próprio WebRTC no par
// de candidatos ICE em uso entre você e o servidor de mídia (LiveKit).
// É o número que importa pra voz — o "ping" HTTP até o Supabase
// (useConnectionPing) mede outra coisa (a API do banco, que pode estar em
// outro continente). Ver docs/PING.md.

export interface MediaPathInfo {
  /** RTT atual em ms (currentRoundTripTime do candidate-pair selecionado). */
  rttMs: number
  /** host | srflx | prflx | relay — "relay" = passando por TURN (mais lento). */
  localCandidateType: string | null
  /** udp | tcp (do candidato local). TCP/TLS = fallback, latência pior. */
  protocol: string | null
  /** Protocolo até o TURN, quando relay (udp/tcp/tls). */
  relayProtocol: string | null
}

type AnyStats = Record<string, unknown> & { id: string; type: string }

function statsList(report: RTCStatsReport | Iterable<AnyStats> | Map<string, AnyStats>): AnyStats[] {
  const out: AnyStats[] = []
  const maybeForEach = report as unknown as { forEach?: (cb: (v: AnyStats) => void) => void }
  if (typeof maybeForEach.forEach === 'function') {
    maybeForEach.forEach((v) => out.push(v))
    return out
  }
  for (const v of report as Iterable<AnyStats>) out.push(v)
  return out
}

/**
 * Acha o par de candidatos em uso e devolve o RTT. Ordem de preferência:
 * transport.selectedCandidatePairId → candidate-pair com `selected` →
 * `nominated` + `state === 'succeeded'`.
 */
export function extractMediaPath(report: RTCStatsReport | Iterable<AnyStats> | Map<string, AnyStats> | undefined | null): MediaPathInfo | null {
  if (!report) return null
  const list = statsList(report)
  const byId = new Map(list.map((s) => [s.id, s]))

  let pair: AnyStats | undefined
  for (const s of list) {
    if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
      pair = byId.get(s.selectedCandidatePairId)
      if (pair) break
    }
  }
  if (!pair) pair = list.find((s) => s.type === 'candidate-pair' && s.selected === true)
  if (!pair) pair = list.find((s) => s.type === 'candidate-pair' && s.nominated === true && s.state === 'succeeded')
  if (!pair) return null

  const rtt = pair.currentRoundTripTime
  if (typeof rtt !== 'number' || !Number.isFinite(rtt) || rtt < 0) return null

  const local = typeof pair.localCandidateId === 'string' ? byId.get(pair.localCandidateId) : undefined
  return {
    rttMs: Math.round(rtt * 1000),
    localCandidateType: typeof local?.candidateType === 'string' ? local.candidateType : null,
    protocol: typeof local?.protocol === 'string' ? local.protocol : null,
    relayProtocol: typeof local?.relayProtocol === 'string' ? local.relayProtocol : null,
  }
}

/** Texto curto pra tooltip: "UDP direto", "via TURN (TCP)" etc. */
export function describeMediaPath(info: MediaPathInfo): string {
  if (info.localCandidateType === 'relay') {
    return `via TURN${info.relayProtocol ? ` (${info.relayProtocol.toUpperCase()})` : ''}`
  }
  const proto = info.protocol ? info.protocol.toUpperCase() : null
  return proto ? `${proto} direto` : 'direto'
}
