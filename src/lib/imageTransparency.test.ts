import { describe, expect, it } from 'vitest'
import { edgeTransparencyRatio, mayHaveTransparency } from './imageTransparency'

function rgba(w: number, h: number, alphaAt: (x: number, y: number) => number) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = alphaAt(x, y)
  return d
}

describe('imageTransparency', () => {
  it('JPEG nunca tem transparência', () => {
    expect(mayHaveTransparency('https://x.supabase.co/a/foto.JPG?t=1')).toBe(false)
    expect(mayHaveTransparency('https://x.supabase.co/a/foto.png')).toBe(true)
  })
  it('imagem opaca tem borda 0% transparente', () => {
    expect(edgeTransparencyRatio(rgba(8, 8, () => 255), 8, 8)).toBe(0)
  })
  it('recorte sem fundo (só o centro opaco) tem borda 100% transparente', () => {
    const d = rgba(8, 8, (x, y) => (x > 1 && x < 6 && y > 1 && y < 6 ? 255 : 0))
    expect(edgeTransparencyRatio(d, 8, 8)).toBe(1)
  })
})
