import { testEncoder, type EncodeCodecKey, type EncodeTestResult } from './hwEncodeTest'

export type HwEncodeSupport = { h264: boolean; vp9: boolean; av1: boolean }
export type HwEncodeDetails = Record<EncodeCodecKey, EncodeTestResult>

const CACHE_KEY = 'mv-hw-encode-test'
const CACHE_MS = 7 * 24 * 3600 * 1000
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
  }
  return null
}

function writeCache(d: HwEncodeDetails) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), v: APP_VERSION, d }))
  } catch {
  }
}

export function probeHardwareDetails(force = false, allowMic = false): Promise<HwEncodeDetails> {
  if (force) {
    cached = null
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch {
    }
  }
  if (!cached) {
    cached = (async () => {
      const hit = readCache()
      if (hit) return hit
      let mic: MediaStream | null = null
      if (allowMic) mic = await navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => null)
      try {
        const d = {} as HwEncodeDetails
        for (const key of ['h264', 'av1', 'vp9'] as EncodeCodecKey[]) d[key] = await testEncoder(key)
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

export function chooseScreenCodec(support: HwEncodeSupport, preferGpu: boolean): ScreenCodec {
  if (!preferGpu) return 'h264'
  if (support.h264) return 'h264'
  if (support.av1) return 'av1'
  if (support.vp9) return 'vp9'
  return 'h264'
}
