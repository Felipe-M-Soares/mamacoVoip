import { describe, expect, it } from 'vitest'
import { comboFromEvent, isUsableCombo, toAccelerator } from './keybinds'

const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('atalhos de teclado', () => {
  it('monta a combinação a partir do evento', () => {
    expect(comboFromEvent(ev('KeyM', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+M')
    expect(comboFromEvent(ev('Digit3', { altKey: true }))).toBe('Alt+3')
    expect(comboFromEvent(ev('F9'))).toBe('F9')
    expect(comboFromEvent(ev('Slash', { ctrlKey: true }))).toBe('Ctrl+/')
    expect(comboFromEvent(ev('ShiftLeft', { shiftKey: true }))).toBeNull()
  })

  it('exige modificador (ou tecla F)', () => {
    expect(isUsableCombo('M')).toBe(false)
    expect(isUsableCombo('Shift+M')).toBe(false)
    expect(isUsableCombo('Ctrl+M')).toBe(true)
    expect(isUsableCombo('F8')).toBe(true)
  })

  it('converte pro formato do Electron', () => {
    expect(toAccelerator('Ctrl+Shift+M')).toBe('Control+Shift+M')
    expect(toAccelerator('Win+Alt+↑')).toBe('Super+Alt+Up')
    expect(toAccelerator('Ctrl+Espaço')).toBe('Control+Space')
    expect(toAccelerator('Ctrl+Num5')).toBe('Control+num5')
  })
})
