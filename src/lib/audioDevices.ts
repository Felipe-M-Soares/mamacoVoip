export const SETTLE_DELAYS_MS = [400, 1500, 3500, 6500] as const

type Listener = () => void
const listeners = new Set<Listener>()
let timers: number[] = []
let attached = false

function fire() {
  for (const t of timers) window.clearTimeout(t)
  timers = SETTLE_DELAYS_MS.map((ms) =>
    window.setTimeout(() => {
      for (const l of [...listeners]) {
        try {
          l()
        } catch {
        }
      }
    }, ms)
  )
}

export function onAudioDevicesSettled(cb: Listener): () => void {
  listeners.add(cb)
  if (!attached && typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', fire)
    attached = true
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && attached) {
      navigator.mediaDevices?.removeEventListener?.('devicechange', fire)
      attached = false
      for (const t of timers) window.clearTimeout(t)
      timers = []
    }
  }
}

type DeviceLike = Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'kind' | 'label'>

export function pickOutputDevice(devices: readonly DeviceLike[], preferred: string | null | undefined): string {
  const outs = devices.filter((d) => d.kind === 'audiooutput')
  if (preferred && preferred !== 'default' && outs.some((d) => d.deviceId === preferred)) return preferred
  const def = outs.find((d) => d.deviceId === 'default')
  if (def?.groupId) {
    const real = outs.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId === def.groupId)
    if (real) return real.deviceId
  }
  return ''
}

export function micNeedsSwap(
  devices: readonly DeviceLike[],
  wanted: string | null | undefined,
  current: { deviceId?: string; groupId?: string }
): boolean {
  const inputs = devices.filter((d) => d.kind === 'audioinput')
  if (wanted && wanted !== 'default') {
    if (inputs.some((d) => d.deviceId === wanted)) return current.deviceId !== wanted
  }
  const def = inputs.find((d) => d.deviceId === 'default')
  if (!def?.groupId) return false
  if (current.groupId) return def.groupId !== current.groupId
  const real = inputs.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId === def.groupId)
  return Boolean(real && current.deviceId && real.deviceId !== current.deviceId && current.deviceId !== 'default')
}

let cachedDevices: { at: number; list: MediaDeviceInfo[] } | null = null

export async function listDevices(): Promise<MediaDeviceInfo[]> {
  const now = Date.now()
  if (cachedDevices && now - cachedDevices.at < 250) return cachedDevices.list
  const list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? []
  cachedDevices = { at: now, list }
  return list
}

type SinkTarget = { setSinkId?: (id: string) => Promise<void>; sinkId?: string }

export async function applyOutput(target: SinkTarget | null | undefined, preferred: string | null | undefined) {
  if (!target?.setSinkId) return
  const id = pickOutputDevice(await listDevices(), preferred)
  if (target.sinkId === id) return
  try {
    await target.setSinkId(id)
  } catch {
    if (id !== '') await target.setSinkId('').catch(() => {})
  }
}
