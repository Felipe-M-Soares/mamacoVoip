// Segue a troca de fone/microfone do sistema (cabo ↔ Bluetooth, plugar e
// tirar headset) sem a pessoa precisar trocar na mão.
//
// Dois problemas que isso resolve:
//  1. Fone Bluetooth demora pra "virar o padrão" do Windows: o evento
//     `devicechange` chega ANTES do padrão mudar. Antes o app olhava uma
//     vez só (800 ms depois) e, se o padrão ainda não tinha mudado, nunca
//     mais trocava. Agora confere de novo algumas vezes (até ~6 s).
//  2. Áudio tocando no "padrão" (sinkId vazio) nem sempre acompanha a
//     troca do padrão no Chromium — continuava saindo no fone antigo (ou
//     em lugar nenhum, se ele foi desligado). Agora o "padrão" é
//     traduzido pro dispositivo REAL que é o padrão naquele momento, e
//     reaplicado sempre que ele muda.

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
          // um ouvinte com erro não pode travar os outros
        }
      }
    }, ms)
  )
}

/**
 * Chama `cb` algumas vezes depois de cada mudança de dispositivos (até o
 * sistema terminar de trocar o padrão). Devolve a função pra parar.
 */
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

/**
 * Qual dispositivo de SAÍDA usar de verdade:
 *  - escolheu um específico e ele existe → ele;
 *  - "Padrão" (ou o escolhido sumiu) → o aparelho que é o padrão agora
 *    (a entrada "default" aponta pra ele pelo groupId);
 *  - não deu pra descobrir → '' (padrão do navegador).
 */
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

/**
 * Microfone: precisa trocar? (`current` = getSettings() da track em uso)
 *  - escolheu um específico e ele voltou/existe → troca se não é o atual;
 *  - "Padrão" → troca se o padrão do sistema agora é outro aparelho.
 */
export function micNeedsSwap(
  devices: readonly DeviceLike[],
  wanted: string | null | undefined,
  current: { deviceId?: string; groupId?: string }
): boolean {
  const inputs = devices.filter((d) => d.kind === 'audioinput')
  if (wanted && wanted !== 'default') {
    if (inputs.some((d) => d.deviceId === wanted)) return current.deviceId !== wanted
    // O escolhido sumiu (ex.: desligou o Bluetooth): segue o padrão.
  }
  const def = inputs.find((d) => d.deviceId === 'default')
  if (!def?.groupId) return false
  if (current.groupId) return def.groupId !== current.groupId
  // Sem groupId na track: compara pelo aparelho real do padrão.
  const real = inputs.find((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId === def.groupId)
  return Boolean(real && current.deviceId && real.deviceId !== current.deviceId && current.deviceId !== 'default')
}

let cachedDevices: { at: number; list: MediaDeviceInfo[] } | null = null

/** enumerateDevices com um cache curtinho (vários elementos pedem juntos). */
export async function listDevices(): Promise<MediaDeviceInfo[]> {
  const now = Date.now()
  if (cachedDevices && now - cachedDevices.at < 250) return cachedDevices.list
  const list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? []
  cachedDevices = { at: now, list }
  return list
}

type SinkTarget = { setSinkId?: (id: string) => Promise<void>; sinkId?: string }

/** Aplica a saída certa num <audio>/AudioContext (só troca se mudou). */
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
