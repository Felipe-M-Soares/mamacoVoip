// Ver loadSettings em hooks/useAudioSettings.ts: quem ainda estava na
// sensibilidade padrão antiga (50) passa pro padrão novo; quem escolheu
// outro valor continua com o seu.
export function migrateSensitivity<T extends { micSensitivity?: number }>(
  stored: T,
  alreadyMigrated: boolean,
  newDefault: number
): T {
  if (alreadyMigrated) return stored
  if (stored.micSensitivity === 50) return { ...stored, micSensitivity: newDefault }
  return stored
}
