import { describe, expect, it } from 'vitest'
import { Fmp4Buffer, findTfdts } from './fmp4'

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const len = 8 + payload.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  new DataView(out.buffer).setUint32(0, len)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  let off = 8
  for (const p of payload) {
    out.set(p, off)
    off += p.length
  }
  return out
}
const u32 = (...v: number[]) => {
  const b = new Uint8Array(v.length * 4)
  v.forEach((x, i) => new DataView(b.buffer).setUint32(i * 4, x))
  return b
}
const full = (version: number) => new Uint8Array([version, 0, 0, 0])
function moov(trackId: number, timescale: number) {
  const tkhd = box('tkhd', full(0), u32(0, 0, trackId, 0, 0))
  const mdhd = box('mdhd', full(0), u32(0, 0, timescale, 0, 0))
  return box('moov', box('trak', tkhd, box('mdia', mdhd)))
}
function frag(trackId: number, t: number) {
  const tfhd = box('tfhd', full(0), u32(trackId))
  const tfdt = box('tfdt', full(0), u32(t))
  return [box('moof', box('traf', tfhd, tfdt)), box('mdat', new Uint8Array([1, 2, 3]))]
}

describe('Fmp4Buffer', () => {
  it('corta os últimos N segundos e zera o tempo', () => {
    const b = new Fmp4Buffer(10)
    const parts = [box('ftyp', new Uint8Array(4)), moov(1, 1000)]
    for (let s = 0; s < 20; s++) parts.push(...frag(1, s * 1000))
    // Chega em pedaços quebrados no meio das caixas.
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let off = 0
    for (const p of parts) {
      all.set(p, off)
      off += p.length
    }
    for (let i = 0; i < all.length; i += 7) b.push(all.slice(i, i + 7))
    const clip = b.clip(5)!
    expect(clip).not.toBeNull()
    // Acha os moof do clipe: 5 pedaços (15..19 s), o primeiro em 0.
    const times: number[] = []
    let o = 0
    const dv = new DataView(clip.buffer)
    while (o < clip.length) {
      const size = dv.getUint32(o)
      const type = String.fromCharCode(...clip.slice(o + 4, o + 8))
      if (type === 'moof') {
        const m = clip.slice(o, o + size)
        const ref = findTfdts(m)[0]
        times.push(new DataView(m.buffer).getUint32(ref.offset))
      }
      o += size
    }
    expect(times).toEqual([0, 1000, 2000, 3000, 4000])
  })
})
