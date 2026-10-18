import { describe, expect, it } from 'vitest'
import { shouldTryCompress, targetSize } from './compressImage'

describe('compressImage', () => {
  it('só tenta em imagens grandes dos tipos suportados', () => {
    expect(shouldTryCompress({ type: 'image/png', size: 900_000 }, 800, 600)).toBe(true)
    expect(shouldTryCompress({ type: 'image/jpeg', size: 100_000 }, 4000, 3000)).toBe(true)
    expect(shouldTryCompress({ type: 'image/jpeg', size: 100_000 }, 800, 600)).toBe(false)
    expect(shouldTryCompress({ type: 'image/gif', size: 9_000_000 }, 4000, 3000)).toBe(false)
  })
  it('limita o lado maior a 2560 mantendo a proporção', () => {
    expect(targetSize(5120, 2880)).toEqual({ width: 2560, height: 1440 })
    expect(targetSize(1000, 4000)).toEqual({ width: 640, height: 2560 })
    expect(targetSize(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })
})
