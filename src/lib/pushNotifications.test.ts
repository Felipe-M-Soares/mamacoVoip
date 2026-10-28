import { describe, expect, it } from 'vitest'
import { parsePushTarget } from './pushNotifications'

const U = '11111111-2222-3333-4444-555555555555'
describe('parsePushTarget', () => {
  it('aceita só destinos válidos', () => {
    expect(parsePushTarget({ kind: 'dm', id: U })).toEqual({ kind: 'dm', id: U, serverId: undefined })
    expect(parsePushTarget({ kind: 'channel', id: U, serverId: U })).toEqual({ kind: 'channel', id: U, serverId: U })
    expect(parsePushTarget({ kind: 'channel', id: U })).toBeNull()
    expect(parsePushTarget({ kind: 'x', id: U })).toBeNull()
    expect(parsePushTarget({ kind: 'dm', id: 'javascript:alert(1)' })).toBeNull()
    expect(parsePushTarget(null)).toBeNull()
  })
})
