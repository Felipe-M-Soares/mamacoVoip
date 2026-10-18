import { describe, expect, it } from 'vitest'
import { iconFitSize } from './iconImage'

describe('iconFitSize', () => {
  it('reduz sem distorcer e não aumenta imagem pequena', () => {
    expect(iconFitSize(512, 256)).toEqual({ width: 128, height: 64 })
    expect(iconFitSize(64, 64)).toEqual({ width: 64, height: 64 })
    expect(iconFitSize(300, 1200)).toEqual({ width: 32, height: 128 })
  })
})
