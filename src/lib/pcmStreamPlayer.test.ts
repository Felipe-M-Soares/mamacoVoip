import { describe, it, expect } from 'vitest'
import { nextPcmStartTime, PCM_MAX_SCHEDULE_AHEAD_S, PCM_REALIGN_LEAD_S } from './pcmStreamPlayer'

describe('nextPcmStartTime', () => {
  it('mantém o agendamento contínuo quando está dentro da janela', () => {
    expect(nextPcmStartTime(10.1, 10)).toBe(10.1)
  })
  it('realinha quando ficou pra trás (buffer esvaziou)', () => {
    expect(nextPcmStartTime(9.5, 10)).toBeCloseTo(10 + PCM_REALIGN_LEAD_S)
  })
  it('descarta o pedaço quando a fila passa do teto (deriva de relógio)', () => {
    expect(nextPcmStartTime(10 + PCM_MAX_SCHEDULE_AHEAD_S + 0.01, 10)).toBeNull()
  })
})
