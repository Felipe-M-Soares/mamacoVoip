import { useState } from 'react'

// TRIGÉSIMA SÉTIMA RODADA — pedido explícito: "colocar todas opções de
// gráfico e fps disponíveis pra transmissão", igual OBS/Discord deixam
// escolher resolução e taxa de quadros de forma INDEPENDENTE uma da
// outra (não só dois pacotes fechados "desempenho" ou "qualidade
// máxima" como antes). Resolução e fps agora são dois controles
// separados — qualquer combinação das duas listas abaixo é válida.
export type ScreenShareResolution = '720p' | '1080p' | '1440p' | 'native'
export type ScreenShareFrameRate = 15 | 30 | 60

const RESOLUTION_KEY = 'mamacos-screenshare-resolution'
const FRAMERATE_KEY = 'mamacos-screenshare-framerate'

interface ResolutionInfo {
  width: number
  height: number
  label: string
}

// "native" (Fonte) usa um teto bem folgado, maior que qualquer monitor
// real hoje em dia (inclusive 8K) — na prática funciona como "sem
// limite", a captura sai na resolução NATIVA da tela da pessoa em vez
// de ser reduzida (ver `capResolution` em buildPreset abaixo).
const RESOLUTIONS: Record<ScreenShareResolution, ResolutionInfo> = {
  '720p': { width: 1280, height: 720, label: '720p (HD)' },
  '1080p': { width: 1920, height: 1080, label: '1080p (Full HD)' },
  '1440p': { width: 2560, height: 1440, label: '1440p (2K)' },
  native: { width: 7680, height: 4320, label: 'Fonte (resolução nativa da sua tela)' },
}

export const RESOLUTION_OPTIONS: { value: ScreenShareResolution; label: string }[] = (
  Object.keys(RESOLUTIONS) as ScreenShareResolution[]
).map((value) => ({ value, label: RESOLUTIONS[value].label }))

export const FRAME_RATE_OPTIONS: ScreenShareFrameRate[] = [15, 30, 60]

// Teto de bitrate por combinação resolução×fps — valores de referência
// comuns de serviços de streaming pra cada combinação (Twitch/YouTube
// publicam tabelas parecidas). É só um TETO: numa tela menor que a
// escolhida, ou com pouco movimento na imagem, o encoder nem chega
// perto de usar tudo isso — só importa (e ajuda de verdade) quando a
// imagem tem bastante detalhe/movimento pra aproveitar.
const BITRATE_TABLE: Record<ScreenShareResolution, Record<ScreenShareFrameRate, number>> = {
  '720p': { 15: 1_200_000, 30: 2_500_000, 60: 4_000_000 },
  '1080p': { 15: 2_500_000, 30: 4_000_000, 60: 6_000_000 },
  '1440p': { 15: 4_500_000, 30: 8_000_000, 60: 12_000_000 },
  // "quality" (rodada anterior) usava 35Mbps pra native/60 — mantido
  // igual aqui, é o valor que já tinha sido calibrado pra 4K/60fps de
  // verdade (referência comum pra isso fica entre 35-45Mbps).
  native: { 15: 8_000_000, 30: 16_000_000, 60: 35_000_000 },
}

export interface QualityPreset {
  width: number
  height: number
  frameRate: number
  maxBitrate: number
  degradationPreference: 'maintain-framerate' | 'maintain-resolution'
  // Se `true`, `width`/`height` são um TETO de verdade (constraint
  // "max" no getDisplayMedia) — a tela é reduzida pra caber nesse
  // limite mesmo que a resolução nativa seja maior. Se `false` (só
  // acontece com resolução "native"), `width`/`height` são só um teto
  // bem folgado pra deixar a captura sair na resolução NATIVA da tela
  // da pessoa, sem reduzir nada.
  capResolution: boolean
  label: string
  description: string
}

function buildPreset(resolution: ScreenShareResolution, frameRate: ScreenShareFrameRate): QualityPreset {
  const res = RESOLUTIONS[resolution]
  const isNative = resolution === 'native'
  return {
    width: res.width,
    height: res.height,
    frameRate,
    maxBitrate: BITRATE_TABLE[resolution][frameRate],
    // Resolução fixa se beneficia de sacrificar quadros quando a rede
    // aperta (a imagem continua nítida, só menos fluida); "native" quase
    // sempre é usada por quem tem internet de sobra e quer nitidez
    // máxima, então prioriza manter a resolução em vez do fps.
    degradationPreference: isNative ? 'maintain-resolution' : 'maintain-framerate',
    capResolution: !isNative,
    label: `${res.label} · ${frameRate}fps`,
    description: isNative
      ? 'Transmite na resolução nativa da sua tela, no bitrate mais alto que dá — exige bem mais do seu PC e da internet de quem assiste.'
      : `Resolução fixa em ${res.label}, ${frameRate} quadros por segundo.`,
  }
}

// Dica de conteúdo pro encoder (MediaStreamTrack.contentHint). Antes era
// SEMPRE 'motion', inclusive em 15fps — que na prática é escolhido pra
// compartilhar texto/código/planilha, justamente o caso em que 'motion'
// borra letras miúdas pra manter fluidez que ninguém pediu. Regra:
// 15fps → 'detail' (nitidez de texto); 30/60fps → 'motion' (jogo/vídeo).
export function contentHintForPreset(preset: Pick<QualityPreset, 'frameRate'>): 'detail' | 'motion' {
  return preset.frameRate <= 15 ? 'detail' : 'motion'
}

// Exportadas (não só internas ao hook) pra permitir uma LEITURA somente-
// exibição do valor atual em lugares fora do VoiceProvider — ver
// ScreenSharePicker.tsx, que mostra "qualidade selecionada" antes de
// compartilhar mas não pode chamar useVoice() (ele existe fora do
// VoiceProvider, que só monta dentro do MainLayout).
export function loadResolution(): ScreenShareResolution {
  try {
    const raw = localStorage.getItem(RESOLUTION_KEY)
    return raw === '720p' || raw === '1080p' || raw === '1440p' || raw === 'native' ? raw : '1080p'
  } catch {
    return '1080p'
  }
}

export function loadFrameRate(): ScreenShareFrameRate {
  try {
    const raw = Number(localStorage.getItem(FRAMERATE_KEY))
    return raw === 15 || raw === 30 || raw === 60 ? raw : 30
  } catch {
    return 30
  }
}

export function loadQualityPreset(): QualityPreset {
  return buildPreset(loadResolution(), loadFrameRate())
}

export function useScreenShareQuality() {
  const [resolution, setResolutionState] = useState<ScreenShareResolution>(loadResolution)
  const [frameRate, setFrameRateState] = useState<ScreenShareFrameRate>(loadFrameRate)

  function setResolution(next: ScreenShareResolution) {
    setResolutionState(next)
    try {
      localStorage.setItem(RESOLUTION_KEY, next)
    } catch {
      // best-effort
    }
  }

  function setFrameRate(next: ScreenShareFrameRate) {
    setFrameRateState(next)
    try {
      localStorage.setItem(FRAMERATE_KEY, String(next))
    } catch {
      // best-effort
    }
  }

  return {
    resolution,
    setResolution,
    frameRate,
    setFrameRate,
    resolutionOptions: RESOLUTION_OPTIONS,
    frameRateOptions: FRAME_RATE_OPTIONS,
    preset: buildPreset(resolution, frameRate),
  }
}
