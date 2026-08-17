import { useState } from 'react'

export type ScreenShareQuality = 'performance' | 'quality'

const STORAGE_KEY = 'mamacos-screenshare-quality'

export interface QualityPreset {
  width: number
  height: number
  frameRate: number
  maxBitrate: number
  degradationPreference: 'maintain-framerate' | 'maintain-resolution'
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
    label: 'Desempenho (1080p/30fps)',
    description: 'Mais leve pra rodar junto com o jogo — recomendado se notar travamentos.',
  },
  quality: {
    width: 3840,
    height: 2160,
    frameRate: 60,
    maxBitrate: 20_000_000,
    degradationPreference: 'maintain-resolution',
    label: 'Qualidade máxima (4K/60fps)',
    description: 'Imagem mais nítida e fluida — exige mais do seu PC e da internet de quem assiste.',
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
