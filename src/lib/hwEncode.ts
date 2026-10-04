import { testEncoder, type EncodeCodecKey, type EncodeTestResult } from './hwEncodeTest'

// Descobre, NESTE computador, em quais formatos a placa de vídeo comprime a
// transmissão — com um teste de verdade (ver hwEncodeTest.ts), não com uma
// lista de placas. Resultado guardado por 7 dias (ou até atualizar o app).

export type HwEncodeSupport = { h264: boolean; vp9: boolean; av1: boolean }
export type HwEncodeDetails = Record<EncodeCodecKey, EncodeTestResult>

const CACHE_KEY = 'mv-hw-encode-test'
const CACHE_MS = 7 * 24 * 3600 * 1000
// Versão do app + do motor (Chromium): trocar o motor refaz o teste.
const APP_VERSION =
  (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev') +
  '|' +
  (typeof navigator !== 'undefined' ? (/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '') : '')

let cached: Promise<HwEncodeDetails> | null = null

function readCache(): HwEncodeDetails | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { at: number; v: string; d: HwEncodeDetails } | null
    if (raw && raw.v === APP_VERSION && Date.now() - raw.at < CACHE_MS && raw.d?.h264) return raw.d
  } catch {
    // sem cache
  }
  return null
}

function writeCache(d: HwEncodeDetails) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), v: APP_VERSION, d }))
  } catch {
    // sem armazenamento
  }
}

/**
 * Resultado detalhado do teste (qual codificador o Chromium usou em cada formato).
 * O Chromium só revela o nome do codificador enquanto o app está usando
 * microfone/câmera (proteção de privacidade) — por isso o teste roda
 * dentro de uma call, ou com `allowMic` (abre o microfone por ~10 s, só
 * quando a pessoa pede o teste nas Configurações).
 */
export function probeHardwareDetails(force = false, allowMic = false): Promise<HwEncodeDetails> {
  if (force) {
    cached = null
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch {
      // ok
    }
  }
  if (!cached) {
    cached = (async () => {
      const hit = readCache()
      if (hit) return hit
      let mic: MediaStream | null = null
      if (allowMic) mic = await navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => null)
      try {
        // Um de cada vez: testes simultâneos disputariam o mesmo codificador.
        const d = {} as HwEncodeDetails
        for (const key of ['h264', 'av1', 'vp9'] as EncodeCodecKey[]) d[key] = await testEncoder(key)
        // Só guarda se o Chromium revelou o codificador (senão o teste não diz nada).
        if (Object.values(d).some((r) => r.impl)) writeCache(d)
        else cached = null
        return d
      } finally {
        mic?.getTracks().forEach((t) => t.stop())
      }
    })()
  }
  return cached
}

export async function probeHardwareEncoders(): Promise<HwEncodeSupport> {
  const d = await probeHardwareDetails()
  return { h264: d.h264.hw === true, vp9: d.vp9.hw === true, av1: d.av1.hw === true }
}

/** Depois de uma transmissão real cair no processador num formato: refaz o teste na próxima. */
export function markCodecSoftwareOnly(codec: EncodeCodecKey) {
  const hit = readCache()
  if (hit) {
    hit[codec] = { hw: false, impl: hit[codec]?.impl ?? null }
    writeCache(hit)
  }
}

export function resetHardwareProbe() {
  cached = null
}

export type ScreenCodec = 'h264' | 'vp8' | 'vp9' | 'av1'

/**
 * Formato da transmissão pela placa de vídeo:
 * H.264 pela placa → AV1 pela placa → VP9 pela placa → H.264 no processador.
 * `preferGpu` false = sempre H.264 (comportamento antigo).
 */
export function chooseScreenCodec(support: HwEncodeSupport, preferGpu: boolean): ScreenCodec {
  if (!preferGpu) return 'h264'
  if (support.h264) return 'h264'
  if (support.av1) return 'av1'
  if (support.vp9) return 'vp9'
  return 'h264'
}
