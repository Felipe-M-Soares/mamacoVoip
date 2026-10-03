// Sensibilidade AUTOMÁTICA: estima o ruído de fundo pelo percentil 20
// das leituras dos últimos ~6 s (mais robusto que média — fala e
// cliques não puxam o piso pra cima) e põe o corte 16 dB acima dele,
// nunca abaixo de -55 dB (abaixo disso o teclado passava em sala
// silenciosa) nem acima de -30 dB (senão cortava voz baixa).
// Chame push() a cada ~150 ms com sampleLevelDb(); devolve o limiar novo
// quando mudou o suficiente (≥1.5 dB), senão null.
export const AUTO_SENSITIVITY_TICK_MS = 150
export function createAutoSensitivity() {
  const WINDOW = Math.round(6000 / AUTO_SENSITIVITY_TICK_MS)
  const readings: number[] = []
  let last: number | null = null
  return {
    push(levelDb: number): number | null {
      readings.push(levelDb)
      if (readings.length > WINDOW) readings.shift()
      if (readings.length < 8) return null
      const sorted = [...readings].sort((a, b) => a - b)
      const floor = sorted[Math.floor(sorted.length * 0.2)]
      const threshold = Math.round(Math.max(-55, Math.min(-30, floor + 16)) * 2) / 2
      if (last !== null && Math.abs(threshold - last) < 1.5) return null
      last = threshold
      return threshold
    },
    /** Último limiar aplicado (pra reaplicar depois de refazer o gráfico). */
    get current() {
      return last
    },
    reset() {
      readings.length = 0
      last = null
    },
  }
}
