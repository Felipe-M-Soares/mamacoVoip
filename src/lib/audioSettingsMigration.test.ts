import { describe, expect, it } from 'vitest'
import { migrateSensitivity } from './audioSettingsMigration'

describe('migrateSensitivity', () => {
  it('quem estava no padrão antigo (50) vai pro novo; quem escolheu outro valor fica', () => {
    expect(migrateSensitivity({ micSensitivity: 50 }, false, 40).micSensitivity).toBe(40)
    expect(migrateSensitivity({ micSensitivity: 70 }, false, 40).micSensitivity).toBe(70)
    expect(migrateSensitivity({ micSensitivity: 50 }, true, 40).micSensitivity).toBe(50)
  })
})
