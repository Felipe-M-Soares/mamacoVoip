import { useState } from 'react'

export type ScreenShareQuality = 'performance' | 'quality'

const STORAGE_KEY = 'mamacos-screenshare-quality'

export interface QualityPreset {
  width: number
  height: number
  frameRate: number
  maxBitrate: number
  degradationPreference: 'maintain-framerate' | 'maintain-resolution'
  // Se `true`, `width`/`height` são um TETO de verdade (constraint
  // "max" no getDisplayMedia) — a tela é reduzida pra caber nesse
  // limite mesmo que a resolução nativa seja maior. Se `false`,
  // `width`/`height` são só um teto bem folgado (maior que qualquer
  // monitor real hoje em dia) pra deixar a captura sair na resolução
  // NATIVA da tela da pessoa, sem reduzir nada.
  capResolution: boolean
  label: string
  description: string
}

export const QUALITY_PRESETS: Record<ScreenShareQuality, QualityPreset> = {
  performance: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 4_000_000,
    degradationPreference: 'maintain-framerate',
    capResolution: true,
    label: 'Desempenho (1080p/30fps)',
    description: 'Mais leve pra rodar junto com o jogo — recomendado se notar travamentos.',
  },
  quality: {
    // Bem acima de qualquer monitor comum (inclusive 4K/8K) — na
    // prática funciona como "sem limite", então a captura sai na
    // resolução NATIVA da tela da pessoa em vez de ser reduzida.
    width: 7680,
    height: 4320,
    frameRate: 60,
    maxBitrate: 20_000_000,
    degradationPreference: 'maintain-resolution',
    capResolution: false,
    label: 'Qualidade máxima (resolução nativa da sua tela, até 60fps)',
    description: 'Transmite do mesmo jeito que sua tela está — exige mais do seu PC e da internet de quem assiste.',
  },
}

function loadQuality(): ScreenShareQuality {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'quality' ? 'quality' : 'performance'
  } catch {
    return 'performance'
  }
}

export function useScreenShareQuality() {
  const [quality, setQualityState] = useState<ScreenShareQuality>(loadQuality)

  function setQuality(next: ScreenShareQuality) {
    setQualityState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // best-effort
    }
  }

  return { quality, setQuality, preset: QUALITY_PRESETS[quality] }
}
