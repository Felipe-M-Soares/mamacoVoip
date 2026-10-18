import { useSyncExternalStore } from 'react'

// "Replay" de transmissão: guarda em memória os últimos ~30 segundos de uma
// transmissão (a sua ou a de quem você está assistindo) e salva um clipe
// quando você clica em "Salvar clipe". Nada sai do seu computador — o
// arquivo vai direto pra sua pasta de downloads.
//
// Como funciona: o MediaRecorder não deixa "cortar" o começo de uma
// gravação em andamento, então rodam DOIS gravadores defasados em 30 s,
// cada um vive 60 s e recomeça. O mais antigo sempre tem entre 30 e 60 s,
// e é ele que vira o clipe. Fica desligado até você ligar (gravar custa
// um pouco de processador e memória — no máximo ~2 × 60 s de vídeo).

export const REPLAY_SECONDS = 30
const VIDEO_BPS = 5_000_000
const AUDIO_BPS = 160_000

const MIME_CANDIDATES: { mime: string; ext: string }[] = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,opus', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=h264,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
]

export function pickRecorderFormat(
  isSupported: (mime: string) => boolean = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
): { mime: string; ext: string } | null {
  for (const c of MIME_CANDIDATES) {
    try {
      if (isSupported(c.mime)) return c
    } catch {
      // ignora e tenta o próximo
    }
  }
  return null
}

/**
 * Qual segmento vira o clipe: o mais antigo que ainda está gravando
 * (é o que tem mais conteúdo, entre `window` e `2 × window`).
 */
export function pickOldestSegment<T extends { startedAt: number }>(segs: readonly T[]): T | null {
  let best: T | null = null
  for (const s of segs) if (!best || s.startedAt < best.startedAt) best = s
  return best
}

export function replaySupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && pickRecorderFormat() !== null
}

type Segment = { rec: MediaRecorder; chunks: Blob[]; startedAt: number }

class ReplayBuffer {
  private segs: Segment[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly stream: MediaStream
  private readonly format: { mime: string; ext: string }
  readonly trackKey: string

  constructor(source: MediaStream, format: { mime: string; ext: string }) {
    // Cópia só com as faixas atuais: se a original ganhar/perder faixa no
    // meio, o gravador não quebra.
    this.stream = new MediaStream([...source.getVideoTracks(), ...source.getAudioTracks()])
    this.trackKey = trackKeyOf(source)
    this.format = format
    this.startSegment()
    this.timer = setInterval(() => this.rotate(), REPLAY_SECONDS * 1000)
  }

  get ext() {
    return this.format.ext
  }

  private startSegment() {
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(this.stream, {
        mimeType: this.format.mime,
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS,
      })
    } catch {
      return
    }
    const seg: Segment = { rec, chunks: [], startedAt: Date.now() }
    rec.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) seg.chunks.push(e.data)
    })
    try {
      rec.start(1000)
    } catch {
      return
    }
    this.segs.push(seg)
  }

  private rotate() {
    // Mantém no máximo 2: o mais antigo (já com 60 s) sai, entra um novo.
    while (this.segs.length >= 2) {
      const old = this.segs.shift()!
      stopQuietly(old.rec)
      old.chunks = []
    }
    this.startSegment()
  }

  async save(): Promise<Blob | null> {
    const seg = pickOldestSegment(this.segs.filter((s) => s.rec.state === 'recording'))
    if (!seg) return null
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      seg.rec.addEventListener('dataavailable', done, { once: true })
      try {
        seg.rec.requestData()
      } catch {
        resolve()
      }
      setTimeout(done, 1500)
    })
    if (!seg.chunks.length) return null
    return new Blob(seg.chunks, { type: this.format.mime.split(';')[0] })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const s of this.segs) {
      stopQuietly(s.rec)
      s.chunks = []
    }
    this.segs = []
  }
}

function stopQuietly(rec: MediaRecorder) {
  try {
    if (rec.state !== 'inactive') rec.stop()
  } catch {
    // já parado
  }
}

function trackKeyOf(stream: MediaStream): string {
  return [...stream.getVideoTracks(), ...stream.getAudioTracks()].map((t) => t.id).join('|')
}

// ---- Estado compartilhado (o quadro da transmissão pode remontar ao
// trocar de destaque; o buffer não pode se perder por isso) ----

const buffers = new Map<string, ReplayBuffer>()
let snapshot: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function emit() {
  snapshot = new Set(buffers.keys())
  listeners.forEach((l) => l())
}

export function useReplayActive(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
    () => snapshot
  )
}

/** Liga o replay de uma transmissão. Retorna false se o navegador não suporta. */
export function startReplay(key: string, stream: MediaStream): boolean {
  if (buffers.has(key)) return true
  const format = pickRecorderFormat()
  if (!format || stream.getVideoTracks().length === 0) return false
  buffers.set(key, new ReplayBuffer(stream, format))
  emit()
  return true
}

export function stopReplay(key: string) {
  const b = buffers.get(key)
  if (!b) return
  b.stop()
  buffers.delete(key)
  emit()
}

/**
 * Chamado sempre que a lista de transmissões muda: desliga o replay das
 * que acabaram/foram fechadas e reinicia as que trocaram de faixa (ex.:
 * a pessoa trocou a janela transmitida).
 */
export function syncReplays(active: ReadonlyMap<string, MediaStream>) {
  let changed = false
  for (const [key, buf] of [...buffers]) {
    const stream = active.get(key)
    if (!stream) {
      buf.stop()
      buffers.delete(key)
      changed = true
      continue
    }
    if (trackKeyOf(stream) !== buf.trackKey) {
      buf.stop()
      const format = pickRecorderFormat()
      if (format && stream.getVideoTracks().length) buffers.set(key, new ReplayBuffer(stream, format))
      else buffers.delete(key)
      changed = true
    }
  }
  if (changed) emit()
}

export function stopAllReplays() {
  if (!buffers.size) return
  for (const b of buffers.values()) b.stop()
  buffers.clear()
  emit()
}

function safeName(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'transmissao'
  )
}

export function clipFileName(name: string, ext: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  return `mamacos-clipe_${safeName(name)}_${stamp}.${ext}`
}

/** Salva o clipe (baixa o arquivo). Retorna false se não tinha nada gravado. */
export async function saveReplayClip(key: string, name: string): Promise<boolean> {
  const b = buffers.get(key)
  if (!b) return false
  const blob = await b.save()
  if (!blob || blob.size === 0) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = clipFileName(name, b.ext)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
