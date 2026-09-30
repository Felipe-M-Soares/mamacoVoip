// Leitura das estatísticas REAIS do vídeo da transmissão de tela (o que o
// encoder está de fato mandando, via RTCRtpSender.getStats()) pra mostrar
// um indicador discreto pra quem transmite — resolução, fps, bitrate e
// codec. Funções puras (testadas em screenShareStats.test.ts); quem chama
// guarda a amostra anterior pra calcular o bitrate pela diferença.

export interface OutboundVideoSample {
  timestamp: number
  bytesSent: number
  framesPerSecond: number | null
  frameWidth: number | null
  frameHeight: number | null
  qualityLimitationReason: string | null
  codec: string | null
  encoderImplementation: string | null
  powerEfficientEncoder: boolean | null
}

export interface ScreenShareStats {
  width: number | null
  height: number | null
  fps: number | null
  bitrateKbps: number | null
  codec: string | null
  // 'bandwidth' | 'cpu' | 'other' | null (null = sem limitação)
  limitation: string | null
  hardwareEncoder: boolean | null
}

type StatsEntry = Record<string, unknown> & { type?: string; id?: string }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Extrai a amostra outbound-rtp de vídeo (a com mais bytes, se houver mais de uma) de um RTCStatsReport. */
export function pickOutboundVideo(report: Iterable<StatsEntry> | null | undefined): OutboundVideoSample | null {
  if (!report) return null
  const entries = Array.from(report)
  const byId = new Map<string, StatsEntry>()
  for (const e of entries) if (typeof e.id === 'string') byId.set(e.id, e)
  let best: StatsEntry | null = null
  for (const e of entries) {
    if (e.type !== 'outbound-rtp') continue
    if (e.kind !== 'video' && e.mediaType !== 'video') continue
    if (!best || (num(e.bytesSent) ?? 0) > (num(best.bytesSent) ?? 0)) best = e
  }
  if (!best) return null
  const codecEntry = typeof best.codecId === 'string' ? byId.get(best.codecId) : undefined
  const mime = typeof codecEntry?.mimeType === 'string' ? codecEntry.mimeType : null
  return {
    timestamp: num(best.timestamp) ?? 0,
    bytesSent: num(best.bytesSent) ?? 0,
    framesPerSecond: num(best.framesPerSecond),
    frameWidth: num(best.frameWidth),
    frameHeight: num(best.frameHeight),
    qualityLimitationReason: typeof best.qualityLimitationReason === 'string' ? best.qualityLimitationReason : null,
    codec: mime ? mime.replace(/^video\//i, '').toUpperCase() : null,
    encoderImplementation: typeof best.encoderImplementation === 'string' ? best.encoderImplementation : null,
    powerEfficientEncoder: typeof best.powerEfficientEncoder === 'boolean' ? best.powerEfficientEncoder : null,
  }
}

/** Combina a amostra atual com a anterior (pro bitrate). */
export function computeScreenShareStats(prev: OutboundVideoSample | null, cur: OutboundVideoSample): ScreenShareStats {
  let bitrateKbps: number | null = null
  if (prev && cur.timestamp > prev.timestamp && cur.bytesSent >= prev.bytesSent) {
    const seconds = (cur.timestamp - prev.timestamp) / 1000
    bitrateKbps = Math.round(((cur.bytesSent - prev.bytesSent) * 8) / 1000 / seconds)
  }
  const limitation = cur.qualityLimitationReason && cur.qualityLimitationReason !== 'none' ? cur.qualityLimitationReason : null
  // powerEfficientEncoder (Chromium recente) diz direto se é encoder de
  // hardware; senão, deduz pelo nome da implementação (OpenH264/libvpx =
  // software; o resto — MediaFoundation, NVENC etc. — é hardware).
  let hardwareEncoder = cur.powerEfficientEncoder
  if (hardwareEncoder === null && cur.encoderImplementation) {
    hardwareEncoder = !/openh264|libvpx|libaom|software/i.test(cur.encoderImplementation)
  }
  return {
    width: cur.frameWidth,
    height: cur.frameHeight,
    fps: cur.framesPerSecond === null ? null : Math.round(cur.framesPerSecond),
    bitrateKbps,
    codec: cur.codec,
    limitation,
    hardwareEncoder,
  }
}

const LIMITATION_LABELS: Record<string, string> = {
  bandwidth: 'limitado pela rede',
  cpu: 'limitado pelo processador',
  other: 'limitado',
}

/** Texto curto pro indicador, ex.: "1080p · 60 fps · 6,8 Mbps · H264 (GPU)". */
export function formatScreenShareStats(s: ScreenShareStats): string {
  const parts: string[] = []
  if (s.height) parts.push(`${s.height}p`)
  if (s.fps !== null) parts.push(`${s.fps} fps`)
  if (s.bitrateKbps !== null) {
    parts.push(s.bitrateKbps >= 1000 ? `${(s.bitrateKbps / 1000).toFixed(1).replace('.', ',')} Mbps` : `${s.bitrateKbps} kbps`)
  }
  if (s.codec) parts.push(s.hardwareEncoder === null ? s.codec : `${s.codec} (${s.hardwareEncoder ? 'GPU' : 'CPU'})`)
  return parts.join(' · ')
}

export function describeLimitation(s: ScreenShareStats): string | null {
  return s.limitation ? LIMITATION_LABELS[s.limitation] ?? 'limitado' : null
}
