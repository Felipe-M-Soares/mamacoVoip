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
      const threshold = Math.round(Math.max(-46, Math.min(-26, floor + 20)) * 2) / 2
      if (last !== null && Math.abs(threshold - last) < 1.5) return null
      last = threshold
      return threshold
    },
    get current() {
      return last
    },
    reset() {
      readings.length = 0
      last = null
    },
  }
}
