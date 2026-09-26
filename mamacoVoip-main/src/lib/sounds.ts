// Sons de interface 100% sintetizados por código — nada de samples
// baixados ou copiados de outro app. A "assinatura sonora" usa um
// intervalo de quinta justa (proporção 3:2, tipo Sol->Ré) subindo pra
// conectar e descendo pra desconectar, com timbres diferentes por tipo
// de evento (triangle pra conexão, sine pra entrada/saída de gente,
// square curtinho pra mute) — uma identidade própria, não uma imitação.

const STORAGE_KEY = 'mamacos-ui-sounds'
let audioCtx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext()
    } catch {
      return null
    }
  }
  return audioCtx
}

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // best-effort
  }
}

interface ToneSpec {
  freq: number
  duration: number
  delay?: number
  type?: OscillatorType
  gain?: number
}

function tone(ctx: AudioContext, dest: AudioNode, { freq, duration, delay = 0, type = 'sine', gain = 0.15 }: ToneSpec) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  const startTime = ctx.currentTime + delay
  g.gain.setValueAtTime(0, startTime)
  g.gain.linearRampToValueAtTime(gain, startTime + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
  osc.connect(g)
  g.connect(dest)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

function playPattern(tones: ToneSpec[]) {
  if (!isSoundEnabled()) return
  const ctx = getContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const master = ctx.createGain()
  master.gain.value = 1
  master.connect(ctx.destination)
  tones.forEach((t) => tone(ctx, master, t))
}

export function playConnectSound() {
  playPattern([
    { freq: 392, duration: 0.14, type: 'triangle', gain: 0.16 },
    { freq: 587, duration: 0.22, delay: 0.09, type: 'triangle', gain: 0.18 },
  ])
}

export function playDisconnectSound() {
  playPattern([
    { freq: 587, duration: 0.14, type: 'triangle', gain: 0.16 },
    { freq: 392, duration: 0.22, delay: 0.09, type: 'triangle', gain: 0.14 },
  ])
}

export function playUserJoinSound() {
  playPattern([{ freq: 740, duration: 0.1, type: 'sine', gain: 0.1 }])
}

export function playUserLeaveSound() {
  playPattern([{ freq: 330, duration: 0.12, type: 'sine', gain: 0.09 }])
}

export function playMuteSound() {
  playPattern([{ freq: 220, duration: 0.06, type: 'square', gain: 0.08 }])
}

export function playUnmuteSound() {
  playPattern([{ freq: 330, duration: 0.06, type: 'square', gain: 0.08 }])
}

export function playMessageSound() {
  playPattern([
    { freq: 523, duration: 0.08, type: 'sine', gain: 0.08 },
    { freq: 659, duration: 0.1, delay: 0.05, type: 'sine', gain: 0.07 },
  ])
}
