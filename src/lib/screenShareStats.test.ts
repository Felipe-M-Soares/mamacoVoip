import { describe, it, expect } from 'vitest'
import { computeScreenShareStats, describeLimitation, formatScreenShareStats, pickOutboundVideo } from './screenShareStats'

function report(bytesSent: number, timestamp: number, extra: Record<string, unknown> = {}) {
  return [
    { id: 'C1', type: 'codec', mimeType: 'video/H264' },
    { id: 'A1', type: 'outbound-rtp', kind: 'audio', bytesSent: 999_999_999, timestamp },
    {
      id: 'V1',
      type: 'outbound-rtp',
      kind: 'video',
      bytesSent,
      timestamp,
      framesPerSecond: 59.7,
      frameWidth: 1920,
      frameHeight: 1080,
      codecId: 'C1',
      qualityLimitationReason: 'none',
      encoderImplementation: 'MediaFoundationVideoEncodeAccelerator',
      ...extra,
    },
  ]
}

describe('estatísticas da transmissão', () => {
  it('pega só o vídeo e resolve o codec', () => {
    const s = pickOutboundVideo(report(1000, 1))
    expect(s?.codec).toBe('H264')
    expect(s?.frameHeight).toBe(1080)
  })

  it('calcula o bitrate pela diferença entre amostras', () => {
    const a = pickOutboundVideo(report(0, 1000))!
    const b = pickOutboundVideo(report(875_000, 2000))!
    const stats = computeScreenShareStats(a, b)
    expect(stats.bitrateKbps).toBe(7000)
    expect(stats.fps).toBe(60)
    expect(stats.hardwareEncoder).toBe(true)
    expect(stats.limitation).toBeNull()
    expect(formatScreenShareStats(stats)).toBe('1080p · 60 fps · 7,0 Mbps · H264 (GPU)')
  })

  it('sem amostra anterior não inventa bitrate', () => {
    const stats = computeScreenShareStats(null, pickOutboundVideo(report(10, 1))!)
    expect(stats.bitrateKbps).toBeNull()
  })

  it('detecta encoder por software e limitação de rede', () => {
    const cur = pickOutboundVideo(report(10, 1, { encoderImplementation: 'OpenH264', qualityLimitationReason: 'bandwidth' }))!
    const stats = computeScreenShareStats(null, cur)
    expect(stats.hardwareEncoder).toBe(false)
    expect(describeLimitation(stats)).toBe('limitado pela rede')
  })

  it('devolve null quando não há vídeo', () => {
    expect(pickOutboundVideo([{ id: 'x', type: 'outbound-rtp', kind: 'audio' }])).toBeNull()
    expect(pickOutboundVideo(null)).toBeNull()
  })
})
