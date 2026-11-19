export interface MediaPathInfo {
  rttMs: number
  localCandidateType: string | null
  protocol: string | null
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

export function describeMediaPath(info: MediaPathInfo): string {
  if (info.localCandidateType === 'relay') {
    return `via TURN${info.relayProtocol ? ` (${info.relayProtocol.toUpperCase()})` : ''}`
  }
  const proto = info.protocol ? info.protocol.toUpperCase() : null
  return proto ? `${proto} direto` : 'direto'
}
