// Cor "de identidade" estável por nome/id — usada em avatares sem foto e
// ícones de servidor sem imagem. Antes todo avatar sem foto era da cor
// de destaque do tema (todo mundo vermelho, impossível distinguir quem
// é quem numa lista), e os servidores usavam um hue aleatório 0-360 que
// às vezes saía verde-limão ou marrom. Aqui a paleta é curada: tons que
// ficam bonitos em cima do fundo escuro, com gradiente suave.
const PALETTE: Array<[string, string]> = [
  ['#f43f5e', '#fb7185'], // rosa
  ['#f97316', '#fbbf24'], // laranja
  ['#eab308', '#facc15'], // âmbar
  ['#22c55e', '#4ade80'], // verde
  ['#14b8a6', '#2dd4bf'], // turquesa
  ['#0ea5e9', '#38bdf8'], // céu
  ['#6366f1', '#818cf8'], // índigo
  ['#8b5cf6', '#a78bfa'], // violeta
  ['#d946ef', '#e879f9'], // magenta
  ['#ef4444', '#f97316'], // brasa
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

export function identityColor(seed: string): string {
  return PALETTE[hashString(seed) % PALETTE.length][0]
}
