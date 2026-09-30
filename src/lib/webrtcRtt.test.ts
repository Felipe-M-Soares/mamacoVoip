import { describe, expect, it } from 'vitest'
import { describeMediaPath, extractMediaPath } from './webrtcRtt'

function report(entries: Array<Record<string, unknown> & { id: string; type: string }>) {
  return new Map(entries.map((e) => [e.id, e]))
}

describe('extractMediaPath', () => {
  it('usa o par selecionado pelo transport', () => {
    const r = report([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP2' },
      { id: 'CP1', type: 'candidate-pair', currentRoundTripTime: 0.5, nominated: true, state: 'succeeded', localCandidateId: 'L1' },
      { id: 'CP2', type: 'candidate-pair', currentRoundTripTime: 0.0234, localCandidateId: 'L2' },
      { id: 'L2', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp' },
    ])
    expect(extractMediaPath(r)).toEqual({ rttMs: 23, localCandidateType: 'srflx', protocol: 'udp', relayProtocol: null })
  })

  it('cai no par nomeado quando não há transport (Firefox)', () => {
    const r = report([
      { id: 'CP1', type: 'candidate-pair', currentRoundTripTime: 0.11, nominated: true, state: 'succeeded', localCandidateId: 'L1' },
      { id: 'L1', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls' },
    ])
    const info = extractMediaPath(r)
    expect(info?.rttMs).toBe(110)
    expect(describeMediaPath(info!)).toBe('via TURN (TLS)')
  })

  it('devolve null sem RTT ou sem par', () => {
    expect(extractMediaPath(undefined)).toBeNull()
    expect(extractMediaPath(report([{ id: 'CP1', type: 'candidate-pair', nominated: true, state: 'succeeded' }]))).toBeNull()
    expect(extractMediaPath(report([{ id: 'X', type: 'inbound-rtp' }]))).toBeNull()
  })
})
