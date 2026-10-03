// Descobre, NESTE computador, quais formatos de vídeo a placa de vídeo
// consegue comprimir (codificador de hardware), usando a mesma API do
// navegador que o WebRTC usa por baixo (WebCodecs, isConfigSupported com
// hardwareAcceleration: 'prefer-hardware' — só responde "sim" se existir
// codificador de hardware de verdade pra aquele formato).
//
// Cada placa é diferente: muita AMD/Intel não tem H.264 por hardware
// liberado no Chromium do Windows, mas tem VP9 ou AV1. A transmissão usa
// o formato que a SUA placa codifica — e só cai pro processador se a
// placa não codificar nenhum.

export type HwEncodeSupport = { h264: boolean; vp9: boolean; av1: boolean }

const PROBES: Record<keyof HwEncodeSupport, string> = {
  h264: 'avc1.42E01F', // H.264 Constrained Baseline (o que o WebRTC usa)
  vp9: 'vp09.00.10.08',
  av1: 'av01.0.04M.08',
}

let cached: Promise<HwEncodeSupport> | null = null

// Formatos que JÁ caíram no processador durante uma transmissão neste
// computador (a placa diz que codifica, mas o WebRTC não usou) — não
// adianta tentar de novo nesses.
const BAD_KEY = 'mv-hw-encode-bad'
function loadBad(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(BAD_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
export function markCodecSoftwareOnly(codec: keyof HwEncodeSupport) {
  const bad = loadBad()
  bad.add(codec)
  try {
    localStorage.setItem(BAD_KEY, JSON.stringify([...bad]))
  } catch {
    // sem armazenamento
  }
}

const WEBRTC_TYPES: Record<keyof HwEncodeSupport, string> = {
  h264: 'video/H264;profile-level-id=42e01f;packetization-mode=1',
  vp9: 'video/VP9',
  av1: 'video/AV1',
}

// Pergunta específica do WebRTC (MediaCapabilities type 'webrtc'):
// `powerEfficient` = vai usar codificador de hardware NA TRANSMISSÃO.
// É mais fiel que o WebCodecs, que usa outro caminho dentro do Chromium.
async function probeWebRtc(codec: keyof HwEncodeSupport): Promise<boolean | null> {
  const mc = (navigator as Navigator & { mediaCapabilities?: MediaCapabilities }).mediaCapabilities
  if (!mc?.encodingInfo) return null
  try {
    const info = await mc.encodingInfo({
      type: 'webrtc',
      video: { contentType: WEBRTC_TYPES[codec], width: 1920, height: 1080, bitrate: 6_000_000, framerate: 60 },
    } as MediaEncodingConfiguration)
    if (!info.supported) return false
    return info.powerEfficient === true
  } catch {
    return null
  }
}

// Reserva (Chromium sem MediaCapabilities 'webrtc'): WebCodecs.
async function probeOne(codec: string, width: number, height: number): Promise<boolean> {
  const VE = (globalThis as { VideoEncoder?: { isConfigSupported?: (c: unknown) => Promise<{ supported?: boolean }> } })
    .VideoEncoder
  if (!VE?.isConfigSupported) return false
  try {
    const res = await Promise.race([
      VE.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 6_000_000,
        framerate: 60,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'realtime',
      }),
      new Promise<{ supported: boolean }>((resolve) => setTimeout(() => resolve({ supported: false }), 2500)),
    ])
    return res?.supported === true
  } catch {
    return false
  }
}

/** Resultado fica guardado (a placa não muda com o app aberto). */
export function probeHardwareEncoders(): Promise<HwEncodeSupport> {
  if (!cached) {
    cached = (async () => {
      const bad = loadBad()
      const out = { h264: false, vp9: false, av1: false } as HwEncodeSupport
      await Promise.all(
        (Object.keys(PROBES) as (keyof HwEncodeSupport)[]).map(async (c) => {
          const webrtc = await probeWebRtc(c)
          const hw = webrtc ?? (await probeOne(PROBES[c], 1920, 1080))
          out[c] = hw && !bad.has(c)
        })
      )
      return out
    })()
  }
  return cached
}

/** Esquece o resultado guardado (depois de marcar um formato como ruim). */
export function resetHardwareProbe() {
  cached = null
}

export type ScreenCodec = 'h264' | 'vp8' | 'vp9' | 'av1'

/**
 * Escolhe o formato da transmissão pela placa de vídeo:
 * H.264 por hardware → VP9 por hardware → AV1 por hardware → H.264 (processador).
 * `preferGpu` false = comportamento antigo (sempre H.264).
 */
export function chooseScreenCodec(support: HwEncodeSupport, preferGpu: boolean): ScreenCodec {
  if (!preferGpu) return 'h264'
  if (support.h264) return 'h264'
  if (support.vp9) return 'vp9'
  if (support.av1) return 'av1'
  return 'h264'
}
