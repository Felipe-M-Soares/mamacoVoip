// Recorte de MP4 fragmentado (o que o MediaRecorder do Chromium grava em
// "video/mp4"): um cabeçalho (ftyp + moov) seguido de pedaços (moof +
// mdat), um por quadro-chave. Com quadro-chave a cada 1 s, dá pra montar
// um clipe dos ÚLTIMOS N segundos exatos juntando o cabeçalho com os
// pedaços finais — sem recodificar nada — e reescrevendo o tempo de cada
// pedaço (tfdt) pra o clipe começar no 0.

type Box = { type: string; start: number; size: number; header: number }

function readBox(buf: Uint8Array, off: number, end: number): Box | null {
  if (off + 8 > end) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let size = dv.getUint32(off)
  const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])
  let header = 8
  if (size === 1) {
    if (off + 16 > end) return null
    const big = dv.getBigUint64(off + 8)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(big)
    header = 16
  } else if (size === 0) {
    size = end - off
  }
  if (size < header) return null
  return { type, start: off, size, header }
}

function children(buf: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = []
  let off = start
  while (off < end) {
    const b = readBox(buf, off, end)
    if (!b || b.start + b.size > end) break
    out.push(b)
    off += b.size
  }
  return out
}

/** track_ID → timescale, lidos do moov. */
export function readTimescales(moov: Uint8Array): Map<number, number> {
  const map = new Map<number, number>()
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const root = readBox(moov, 0, moov.length)
  if (!root || root.type !== 'moov') return map
  for (const trak of children(moov, root.header, root.size)) {
    if (trak.type !== 'trak') continue
    let id = 0
    let scale = 0
    for (const c of children(moov, trak.start + trak.header, trak.start + trak.size)) {
      if (c.type === 'tkhd') {
        const v = moov[c.start + c.header]
        id = dv.getUint32(c.start + c.header + (v === 1 ? 20 : 12))
      } else if (c.type === 'mdia') {
        for (const m of children(moov, c.start + c.header, c.start + c.size)) {
          if (m.type !== 'mdhd') continue
          const v = moov[m.start + m.header]
          scale = dv.getUint32(m.start + m.header + (v === 1 ? 20 : 12))
        }
      }
    }
    if (id && scale) map.set(id, scale)
  }
  return map
}

type TfdtRef = { trackId: number; offset: number; version: number }

/** Acha os tfdt (tempo de início) de cada faixa dentro de um moof. */
export function findTfdts(moof: Uint8Array): TfdtRef[] {
  const out: TfdtRef[] = []
  const dv = new DataView(moof.buffer, moof.byteOffset, moof.byteLength)
  const root = readBox(moof, 0, moof.length)
  if (!root || root.type !== 'moof') return out
  for (const traf of children(moof, root.header, root.size)) {
    if (traf.type !== 'traf') continue
    let trackId = 0
    let ref: Omit<TfdtRef, 'trackId'> | null = null
    for (const c of children(moof, traf.start + traf.header, traf.start + traf.size)) {
      if (c.type === 'tfhd') trackId = dv.getUint32(c.start + c.header + 4)
      else if (c.type === 'tfdt') ref = { offset: c.start + c.header + 4, version: moof[c.start + c.header] }
    }
    if (trackId && ref) out.push({ trackId, ...ref })
  }
  return out
}

function readTime(buf: Uint8Array, ref: TfdtRef): bigint {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return ref.version === 1 ? dv.getBigUint64(ref.offset) : BigInt(dv.getUint32(ref.offset))
}
function writeTime(buf: Uint8Array, ref: TfdtRef, value: bigint) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const v = value < 0n ? 0n : value
  if (ref.version === 1) dv.setBigUint64(ref.offset, v)
  else dv.setUint32(ref.offset, Number(v & 0xffffffffn))
}

type Fragment = { bytes: Uint8Array; startSec: number; tfdt: Map<number, bigint> }

/** Junta os pedaços que chegam do MediaRecorder e guarda só os últimos segundos. */
export class Fmp4Buffer {
  private pending = new Uint8Array(0)
  private init: Uint8Array | null = null
  private initParts: Uint8Array[] = []
  private scales = new Map<number, number>()
  private mainTrack = 0
  private lastMoof: Uint8Array | null = null
  private fragments: Fragment[] = []
  readonly keepSeconds: number

  constructor(keepSeconds: number) {
    this.keepSeconds = keepSeconds
  }

  get ready(): boolean {
    return this.init !== null && this.fragments.length > 0
  }

  push(chunk: Uint8Array) {
    const merged = new Uint8Array(this.pending.length + chunk.length)
    merged.set(this.pending)
    merged.set(chunk, this.pending.length)
    let off = 0
    for (;;) {
      const b = readBox(merged, off, merged.length)
      if (!b || b.start + b.size > merged.length) break
      this.onBox(b.type, merged.slice(b.start, b.start + b.size))
      off += b.size
    }
    this.pending = merged.slice(off)
  }

  private onBox(type: string, bytes: Uint8Array) {
    if (!this.init) {
      if (type === 'moof') {
        this.init = concat(this.initParts)
        this.initParts = []
      } else {
        this.initParts.push(bytes)
        if (type === 'moov') {
          this.scales = readTimescales(bytes)
          // Faixa de referência pro tempo: a de maior escala costuma ser o
          // vídeo; qualquer uma serve, desde que seja sempre a mesma.
          let best = 0
          for (const [id, sc] of this.scales) if (!best || sc > (this.scales.get(best) ?? 0)) best = id
          this.mainTrack = best
        }
        return
      }
    }
    if (type === 'moof') {
      this.lastMoof = bytes
      return
    }
    if (type === 'mdat' && this.lastMoof) {
      const moof = this.lastMoof
      this.lastMoof = null
      const tfdt = new Map<number, bigint>()
      for (const ref of findTfdts(moof)) tfdt.set(ref.trackId, readTime(moof, ref))
      const main = tfdt.get(this.mainTrack) ?? [...tfdt.values()][0] ?? 0n
      const scale = this.scales.get(this.mainTrack) ?? 1000
      this.fragments.push({ bytes: concat([moof, bytes]), startSec: Number(main) / scale, tfdt })
      this.prune()
    }
  }

  private prune() {
    const last = this.fragments[this.fragments.length - 1]
    if (!last) return
    const cutoff = last.startSec - this.keepSeconds - 2
    while (this.fragments.length > 1 && this.fragments[0].startSec < cutoff) this.fragments.shift()
  }

  /** Clipe dos últimos `seconds` segundos (MP4 que começa no tempo 0). */
  clip(seconds: number): Uint8Array | null {
    if (!this.init || this.fragments.length === 0) return null
    const last = this.fragments[this.fragments.length - 1]
    const avg =
      this.fragments.length > 1 ? (last.startSec - this.fragments[0].startSec) / (this.fragments.length - 1) : 1
    const endSec = last.startSec + Math.max(0.2, avg)
    const from = endSec - seconds
    let idx = this.fragments.findIndex((f) => f.startSec >= from - 0.05)
    if (idx < 0) idx = this.fragments.length - 1
    const picked = this.fragments.slice(idx)
    const base = picked[0].tfdt
    const parts: Uint8Array[] = [this.init]
    for (const f of picked) {
      const copy = f.bytes.slice()
      // O moof é a primeira caixa do pedaço — reescreve o tempo nele.
      for (const ref of findTfdts(copy)) {
        const b = base.get(ref.trackId) ?? 0n
        writeTime(copy, ref, readTime(copy, ref) - b)
      }
      parts.push(copy)
    }
    return concat(parts)
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}
