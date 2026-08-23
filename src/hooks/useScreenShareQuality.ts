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
    // 20Mbps começava a comprimir visivelmente em 4K/60fps (referência
    // comum pra 4K60 de qualidade é algo entre 35-45Mbps) — subindo pra
    // 35Mbps, mesmo transmissões em resolução bem alta saem nítidas.
    // Isso é só um TETO: numa tela 1080p normal o encoder nem chega
    // perto de usar tudo isso, então não pesa nada a mais pra quem tem
    // tela menor — só importa (e ajuda de verdade) pra quem tem monitor
    // 1440p/4K.
    maxBitrate: 35_000_000,
    degradationPreference: 'maintain-resolution',
    capResolution: false,
    label: 'Qualidade máxima (resolução nativa da sua tela, até 60fps)',
    description: 'Transmite do mesmo jeito que sua tela está, no bitrate mais alto que dá — exige bem mais do seu PC e da internet de quem assiste (recomendado só com internet rápida dos dois lados).',
  },
}

// Exportada (não só interna ao hook) pra permitir uma LEITURA somente-
// exibição do valor atual em lugares fora do VoiceProvider — ver
// ScreenSharePicker.tsx, que mostra "qualidade selecionada" antes de
// compartilhar mas não pode chamar useVoice() (ele existe fora do
// VoiceProvider, que só monta dentro do MainLayout).
export function loadQuality(): ScreenShareQuality {
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
