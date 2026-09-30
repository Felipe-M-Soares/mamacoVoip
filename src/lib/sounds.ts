// Identidade sonora do Mamacos Voip — 100% sintetizada por código em
// WebAudio, sem nenhum sample baixado ou copiado de outro app.
//
// A "família" sonora: sinos FM suaves (uma senoide portadora modulada
// por outra senoide cujo índice cai rápido — ataque brilhante que vira
// um tom redondo), todos afinados na mesma escala pentatônica de Ré
// maior (Ré, Mi, Fá#, Lá, Si), com um reverb sintético curto (resposta
// ao impulso gerada com ruído que decai) pra dar "ar" sem embolar.
// Eventos positivos sobem, negativos descem; mute/desmute são "clicks"
// com glissando curtinho; transmissão ganha um sopro de ruído filtrado.
//
// Gerenciamento de recursos: UM AudioContext só (criado na primeira vez
// que um som toca) e um barramento fixo (volume → limitador → saída,
// mais o reverb). Cada som cria os próprios osciladores/ganhos e
// DESCONECTA tudo quando termina — nada fica pendurado no grafo.

const STORAGE_KEY = 'mamacos-ui-sounds'
const VOLUME_KEY = 'mamacos-ui-sounds-volume'
const DEFAULT_VOLUME = 70
// Folga geral: com o volume em 100% o pico fica bem abaixo de 0 dBFS,
// e o limitador segura o resto se dois sons se sobrepuserem.
const HEADROOM = 0.55

let audioCtx: AudioContext | null = null
let busGain: GainNode | null = null
let reverbIn: ConvolverNode | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx || audioCtx.state === 'closed') {
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor({ latencyHint: 'interactive' })
      busGain = null
      reverbIn = null
    } catch {
      return null
    }
  }
  return audioCtx
}

// Resposta ao impulso sintética: ruído estéreo com decaimento
// exponencial (~1,1 s). Barata de gerar e só é criada uma vez.
function buildImpulse(ctx: AudioContext): AudioBuffer {
  const seconds = 1.1
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * 0.5
    }
  }
  return buffer
}

function getBus(ctx: AudioContext): { bus: GainNode; reverb: ConvolverNode } {
  if (!busGain || !reverbIn) {
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    limiter.connect(ctx.destination)

    busGain = ctx.createGain()
    busGain.connect(limiter)

    reverbIn = ctx.createConvolver()
    reverbIn.buffer = buildImpulse(ctx)
    const reverbReturn = ctx.createGain()
    reverbReturn.gain.value = 0.9
    reverbIn.connect(reverbReturn)
    reverbReturn.connect(busGain)
  }
  busGain.gain.value = (getSoundVolume() / 100) * HEADROOM
  return { bus: busGain, reverb: reverbIn }
}

// ---------------------------------------------------------------------
// Preferências
// ---------------------------------------------------------------------

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
  if (!enabled) stopIncomingCallRing()
}

/** Volume dos efeitos sonoros, 0–100. */
export function getSoundVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw === null) return DEFAULT_VOLUME
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function setSoundVolume(volume: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(volume)))
  try {
    localStorage.setItem(VOLUME_KEY, String(clamped))
  } catch {
    // best-effort
  }
  if (busGain) busGain.gain.value = (clamped / 100) * HEADROOM
}

// ---------------------------------------------------------------------
// Síntese
// ---------------------------------------------------------------------

// Escala da marca (Ré maior pentatônica)
const N = {
  D4: 293.66,
  F4: 349.23,
  A4: 440,
  B4: 493.88,
  D5: 587.33,
  E5: 659.25,
  Fs5: 739.99,
  A5: 880,
  B5: 987.77,
  D6: 1174.66,
  Fs6: 1479.98,
  A6: 1760,
} as const

interface Note {
  /** Frequência inicial (Hz) */
  f: number
  /** Atraso em segundos a partir do início do som */
  at?: number
  /** Duração do decaimento em segundos */
  d: number
  /** Pico de ganho relativo (0–1) */
  g?: number
  /** Razão modulador/portadora do FM (timbre). 2 = sino limpo, 3.5 = metálico */
  ratio?: number
  /** Índice de modulação inicial (brilho do ataque) */
  index?: number
  /** Glissando: frequência final */
  to?: number
  /** Quanto vai pro reverb (0–1) */
  wet?: number
}

interface NoiseSweep {
  at?: number
  d: number
  from: number
  to: number
  g?: number
}

interface SoundSpec {
  notes: Note[]
  noise?: NoiseSweep[]
}

function scheduleNote(ctx: AudioContext, out: AudioNode, start: number, n: Note, nodes: AudioNode[]): number {
  const t0 = start + (n.at ?? 0)
  const end = t0 + n.d
  const peak = n.g ?? 0.5
  const ratio = n.ratio ?? 2
  const index = n.index ?? 1.2

  const carrier = ctx.createOscillator()
  carrier.type = 'sine'
  carrier.frequency.setValueAtTime(n.f, t0)
  if (n.to) carrier.frequency.exponentialRampToValueAtTime(n.to, t0 + Math.min(n.d * 0.6, 0.12))

  const mod = ctx.createOscillator()
  mod.type = 'sine'
  mod.frequency.setValueAtTime(n.f * ratio, t0)
  if (n.to) mod.frequency.exponentialRampToValueAtTime(n.to * ratio, t0 + Math.min(n.d * 0.6, 0.12))
  const modGain = ctx.createGain()
  modGain.gain.setValueAtTime(n.f * index, t0)
  modGain.gain.exponentialRampToValueAtTime(Math.max(1, n.f * index * 0.04), t0 + n.d * 0.5)
  mod.connect(modGain)
  modGain.connect(carrier.frequency)

  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.006)
  amp.gain.exponentialRampToValueAtTime(0.0001, end)
  carrier.connect(amp)
  amp.connect(out)

  carrier.start(t0)
  mod.start(t0)
  carrier.stop(end + 0.02)
  mod.stop(end + 0.02)
  nodes.push(carrier, mod, modGain, amp)
  return end
}

let noiseBuffer: AudioBuffer | null = null
function getNoise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const len = Math.floor(ctx.sampleRate * 0.8)
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

function scheduleNoise(ctx: AudioContext, out: AudioNode, start: number, s: NoiseSweep, nodes: AudioNode[]): number {
  const t0 = start + (s.at ?? 0)
  const end = t0 + s.d
  const src = ctx.createBufferSource()
  src.buffer = getNoise(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 2.2
  filter.frequency.setValueAtTime(s.from, t0)
  filter.frequency.exponentialRampToValueAtTime(s.to, end)
  const amp = ctx.createGain()
  const peak = s.g ?? 0.3
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(peak, t0 + s.d * 0.45)
  amp.gain.exponentialRampToValueAtTime(0.0001, end)
  src.connect(filter)
  filter.connect(amp)
  amp.connect(out)
  src.start(t0)
  src.stop(end + 0.02)
  nodes.push(src, filter, amp)
  return end
}

function render(spec: SoundSpec, wet = 0.22) {
  const ctx = getContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const { bus, reverb } = getBus(ctx)

  const voice = ctx.createGain()
  const send = ctx.createGain()
  send.gain.value = wet
  voice.connect(bus)
  voice.connect(send)
  send.connect(reverb)

  const nodes: AudioNode[] = [voice, send]
  const start = ctx.currentTime + 0.01
  let end = start
  for (const n of spec.notes) end = Math.max(end, scheduleNote(ctx, voice, start, n, nodes))
  for (const s of spec.noise ?? []) end = Math.max(end, scheduleNoise(ctx, voice, start, s, nodes))

  const ms = (end - ctx.currentTime) * 1000 + 80
  setTimeout(() => {
    for (const node of nodes) {
      try {
        node.disconnect()
      } catch {
        // já desconectado
      }
    }
  }, ms)
}

// ---------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------

export type UiSoundId =
  | 'connect'
  | 'disconnect'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'message'
  | 'mention'
  | 'incomingCall'
  | 'callEnded'
  | 'streamStart'
  | 'streamStop'
  | 'error'
  | 'friendRequest'

const SPECS: Record<UiSoundId, { spec: SoundSpec; wet?: number }> = {
  connect: {
    spec: {
      notes: [
        { f: N.A4, d: 0.22, g: 0.42 },
        { f: N.D5, at: 0.075, d: 0.24, g: 0.45 },
        { f: N.A5, at: 0.15, d: 0.42, g: 0.42, index: 1.5 },
      ],
    },
  },
  disconnect: {
    spec: {
      notes: [
        { f: N.A5, d: 0.2, g: 0.36 },
        { f: N.D5, at: 0.075, d: 0.22, g: 0.4 },
        { f: N.A4, at: 0.15, d: 0.4, g: 0.42, index: 0.8 },
      ],
    },
  },
  userJoin: {
    spec: {
      notes: [
        { f: N.D5, d: 0.16, g: 0.3, index: 0.9 },
        { f: N.A5, at: 0.07, d: 0.26, g: 0.32, index: 1.1 },
      ],
    },
  },
  userLeave: {
    spec: {
      notes: [
        { f: N.Fs5, d: 0.16, g: 0.28, index: 0.8 },
        { f: N.D5, at: 0.07, d: 0.26, g: 0.3, index: 0.6 },
      ],
    },
  },
  mute: {
    spec: { notes: [{ f: N.A5, to: N.D5, d: 0.1, g: 0.34, ratio: 1, index: 0.5 }] },
    wet: 0.08,
  },
  unmute: {
    spec: { notes: [{ f: N.D5, to: N.A5, d: 0.1, g: 0.34, ratio: 1, index: 0.5 }] },
    wet: 0.08,
  },
  deafen: {
    spec: {
      notes: [
        { f: N.D5, to: N.A4, d: 0.12, g: 0.34, ratio: 1, index: 0.5 },
        { f: N.A4, to: N.D4, at: 0.09, d: 0.16, g: 0.34, ratio: 1, index: 0.4 },
      ],
    },
    wet: 0.1,
  },
  undeafen: {
    spec: {
      notes: [
        { f: N.D4, to: N.A4, d: 0.12, g: 0.34, ratio: 1, index: 0.4 },
        { f: N.A4, to: N.D5, at: 0.09, d: 0.16, g: 0.34, ratio: 1, index: 0.5 },
      ],
    },
    wet: 0.1,
  },
  message: {
    spec: {
      notes: [
        { f: N.Fs5, d: 0.12, g: 0.26, index: 0.9 },
        { f: N.B5, at: 0.055, d: 0.28, g: 0.28, index: 1 },
      ],
    },
  },
  mention: {
    spec: {
      notes: [
        { f: N.D6, d: 0.14, g: 0.28, index: 1.6 },
        { f: N.Fs6, at: 0.06, d: 0.14, g: 0.26, index: 1.6 },
        { f: N.A6, at: 0.12, d: 0.36, g: 0.26, index: 1.8 },
        { f: N.D5, at: 0.12, d: 0.36, g: 0.18, index: 0.6 },
      ],
    },
    wet: 0.26,
  },
  // Uma "frase" do toque de chamada — startIncomingCallRing repete em loop.
  incomingCall: {
    spec: {
      notes: [
        { f: N.D5, d: 0.26, g: 0.32 },
        { f: N.Fs5, at: 0.13, d: 0.26, g: 0.32 },
        { f: N.A5, at: 0.26, d: 0.3, g: 0.34 },
        { f: N.Fs5, at: 0.46, d: 0.22, g: 0.28 },
        { f: N.A5, at: 0.6, d: 0.5, g: 0.3, index: 1.4 },
        { f: N.D5, at: 0.6, d: 0.5, g: 0.18, index: 0.5 },
      ],
    },
    wet: 0.3,
  },
  callEnded: {
    spec: {
      notes: [
        { f: N.A5, d: 0.2, g: 0.3, index: 0.8 },
        { f: N.Fs5, at: 0.1, d: 0.22, g: 0.3, index: 0.7 },
        { f: N.D5, at: 0.2, d: 0.42, g: 0.34, index: 0.5 },
      ],
    },
  },
  streamStart: {
    spec: {
      notes: [
        { f: N.D5, at: 0.14, d: 0.22, g: 0.3 },
        { f: N.A5, at: 0.2, d: 0.36, g: 0.32, index: 1.4 },
      ],
      noise: [{ d: 0.26, from: 500, to: 4200, g: 0.16 }],
    },
  },
  streamStop: {
    spec: {
      notes: [
        { f: N.A5, d: 0.2, g: 0.28, index: 0.9 },
        { f: N.D5, at: 0.08, d: 0.34, g: 0.3, index: 0.6 },
      ],
      noise: [{ at: 0.02, d: 0.26, from: 3800, to: 450, g: 0.13 }],
    },
  },
  error: {
    spec: {
      notes: [
        { f: N.B4, d: 0.14, g: 0.36, ratio: 3.5, index: 0.5 },
        { f: N.F4, at: 0.1, d: 0.26, g: 0.38, ratio: 3.5, index: 0.45 },
      ],
    },
    wet: 0.12,
  },
  friendRequest: {
    spec: {
      notes: [
        { f: N.D5, d: 0.16, g: 0.24 },
        { f: N.Fs5, at: 0.05, d: 0.16, g: 0.24 },
        { f: N.A5, at: 0.1, d: 0.18, g: 0.25 },
        { f: N.D6, at: 0.15, d: 0.42, g: 0.26, index: 1.5 },
      ],
    },
    wet: 0.3,
  },
}

/** Lista exibida em Configurações → Voz e áudio (prévia de cada som). */
export const SOUND_CATALOG: { id: UiSoundId; label: string }[] = [
  { id: 'connect', label: 'Entrar na call' },
  { id: 'disconnect', label: 'Sair da call' },
  { id: 'userJoin', label: 'Alguém entrou' },
  { id: 'userLeave', label: 'Alguém saiu' },
  { id: 'mute', label: 'Mutar' },
  { id: 'unmute', label: 'Desmutar' },
  { id: 'deafen', label: 'Ensurdecer' },
  { id: 'undeafen', label: 'Desensurdecer' },
  { id: 'message', label: 'Mensagem recebida' },
  { id: 'mention', label: 'Menção' },
  { id: 'incomingCall', label: 'Chamada chegando' },
  { id: 'callEnded', label: 'Chamada encerrada' },
  { id: 'streamStart', label: 'Transmissão iniciada' },
  { id: 'streamStop', label: 'Transmissão encerrada' },
  { id: 'friendRequest', label: 'Pedido de amizade' },
  { id: 'error', label: 'Erro' },
]

// Evita metralhadora de som (ex.: 10 mensagens chegando juntas).
const MIN_GAP_MS: Partial<Record<UiSoundId, number>> = { message: 900, mention: 600, userJoin: 250, userLeave: 250 }
const DEFAULT_GAP_MS = 90
const lastPlayed = new Map<UiSoundId, number>()
// Ensurdecer também muta o microfone (toggleDeafen chama toggleMute) —
// nessa janela o som de mute é engolido pra não tocar os dois juntos.
let suppressMuteUntil = 0

/** Toca um som de interface (respeita o liga/desliga de sons). */
function playUiSound(id: UiSoundId) {
  if (!isSoundEnabled()) return
  const now = Date.now()
  if ((id === 'mute' || id === 'unmute') && now < suppressMuteUntil) return
  const last = lastPlayed.get(id) ?? 0
  if (now - last < (MIN_GAP_MS[id] ?? DEFAULT_GAP_MS)) return
  lastPlayed.set(id, now)
  if (id === 'deafen' || id === 'undeafen') suppressMuteUntil = now + 200
  const { spec, wet } = SPECS[id]
  render(spec, wet)
}

/** Prévia em Configurações: toca mesmo com os sons desligados. */
export function previewUiSound(id: UiSoundId) {
  const { spec, wet } = SPECS[id]
  render(spec, wet)
}

// ---------------------------------------------------------------------
// Toque de chamada em loop
// ---------------------------------------------------------------------

let ringTimer: ReturnType<typeof setInterval> | null = null
let ringStopTimer: ReturnType<typeof setTimeout> | null = null
const RING_PERIOD_MS = 2400
const RING_MAX_MS = 45_000

/** Começa o toque de "chamada chegando" (loop suave, para sozinho em 45 s). */
export function startIncomingCallRing(): () => void {
  stopIncomingCallRing()
  if (!isSoundEnabled()) return stopIncomingCallRing
  const ring = () => render(SPECS.incomingCall.spec, SPECS.incomingCall.wet)
  ring()
  ringTimer = setInterval(ring, RING_PERIOD_MS)
  ringStopTimer = setTimeout(stopIncomingCallRing, RING_MAX_MS)
  return stopIncomingCallRing
}

export function stopIncomingCallRing() {
  if (ringTimer) clearInterval(ringTimer)
  if (ringStopTimer) clearTimeout(ringStopTimer)
  ringTimer = null
  ringStopTimer = null
}

// ---------------------------------------------------------------------
// Atalhos com nome (API usada pelo resto do app)
// ---------------------------------------------------------------------

export const playConnectSound = () => playUiSound('connect')
export const playDisconnectSound = () => playUiSound('disconnect')
export const playUserJoinSound = () => playUiSound('userJoin')
export const playUserLeaveSound = () => playUiSound('userLeave')
export const playMuteSound = () => playUiSound('mute')
export const playUnmuteSound = () => playUiSound('unmute')
export const playDeafenSound = () => playUiSound('deafen')
export const playUndeafenSound = () => playUiSound('undeafen')
export const playMessageSound = () => playUiSound('message')
export const playMentionSound = () => playUiSound('mention')
export const playCallEndedSound = () => playUiSound('callEnded')
export const playStreamStartSound = () => playUiSound('streamStart')
export const playStreamStopSound = () => playUiSound('streamStop')
export const playErrorSound = () => playUiSound('error')
export const playFriendRequestSound = () => playUiSound('friendRequest')
