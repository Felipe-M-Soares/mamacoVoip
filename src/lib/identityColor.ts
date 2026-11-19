const PALETTE: Array<[string, string]> = [
  ['#f43f5e', '#fb7185'],
  ['#f97316', '#fbbf24'],
  ['#eab308', '#facc15'],
  ['#22c55e', '#4ade80'],
  ['#14b8a6', '#2dd4bf'],
  ['#0ea5e9', '#38bdf8'],
  ['#6366f1', '#818cf8'],
  ['#8b5cf6', '#a78bfa'],
  ['#d946ef', '#e879f9'],
  ['#ef4444', '#f97316'],
]

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

export function identityGradient(seed: string): string {
  const [a, b] = PALETTE[hashString(seed) % PALETTE.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}
