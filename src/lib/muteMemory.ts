// Lembra o volume de antes de silenciar, pra o "desmutar" voltar no mesmo
// ponto (e não num valor fixo). Vale pra transmissões, vozes e efeitos.
const lastVolume = new Map<string, number>()

export function toggleVolumeMute(key: string, current: number, set: (v: number) => void, fallback: number) {
  if (current === 0) {
    set(lastVolume.get(key) ?? fallback)
  } else {
    lastVolume.set(key, current)
    set(0)
  }
}

/** Guarda o último volume não-zero escolhido no controle deslizante. */
export function rememberVolume(key: string, v: number) {
  if (v > 0) lastVolume.set(key, v)
}
