import { describe, expect, it } from 'vitest'
import { micNeedsSwap, pickOutputDevice } from './audioDevices'

const dev = (kind: MediaDeviceKind, deviceId: string, groupId: string) => ({ kind, deviceId, groupId, label: deviceId })

describe('pickOutputDevice', () => {
  const list = [
    dev('audiooutput', 'default', 'bt'),
    dev('audiooutput', 'communications', 'cabo'),
    dev('audiooutput', 'fone-cabo', 'cabo'),
    dev('audiooutput', 'fone-bt', 'bt'),
  ]
  it('padrão vira o aparelho real que é o padrão agora', () => {
    expect(pickOutputDevice(list, null)).toBe('fone-bt')
    expect(pickOutputDevice(list, 'default')).toBe('fone-bt')
  })
  it('respeita o escolhido e cai pro padrão se ele sumir', () => {
    expect(pickOutputDevice(list, 'fone-cabo')).toBe('fone-cabo')
    expect(pickOutputDevice(list, 'sumiu')).toBe('fone-bt')
  })
  it('sem informação → padrão do navegador', () => {
    expect(pickOutputDevice([], null)).toBe('')
  })
})

describe('micNeedsSwap', () => {
  const list = [dev('audioinput', 'default', 'bt'), dev('audioinput', 'mic-cabo', 'cabo'), dev('audioinput', 'mic-bt', 'bt')]
  it('padrão mudou pro Bluetooth → troca', () => {
    expect(micNeedsSwap(list, null, { deviceId: 'default', groupId: 'cabo' })).toBe(true)
    expect(micNeedsSwap(list, null, { deviceId: 'default', groupId: 'bt' })).toBe(false)
  })
  it('escolhido voltou → troca pra ele; escolhido sumiu → segue o padrão', () => {
    expect(micNeedsSwap(list, 'mic-cabo', { deviceId: 'mic-bt', groupId: 'bt' })).toBe(true)
    expect(micNeedsSwap(list, 'mic-cabo', { deviceId: 'mic-cabo', groupId: 'cabo' })).toBe(false)
    expect(micNeedsSwap(list, 'sumiu', { deviceId: 'mic-cabo', groupId: 'cabo' })).toBe(true)
  })
})
