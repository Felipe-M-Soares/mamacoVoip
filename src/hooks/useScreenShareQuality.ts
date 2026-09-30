import { useState } from 'react'

// TRIGÉSIMA SÉTIMA RODADA — pedido explícito: "colocar todas opções de
// gráfico e fps disponíveis pra transmissão", igual OBS deixam
// escolher resolução e taxa de quadros de forma INDEPENDENTE uma da
// outra (não só dois pacotes fechados "desempenho" ou "qualidade
// máxima" como antes). Resolução e fps agora são dois controles
// separados — qualquer combinação das duas listas abaixo é válida.
export type ScreenShareResolution = '720p' | '1080p' | '1440p' | 'native'
export type ScreenShareFrameRate = 15 | 30 | 60

const RESOLUTION_KEY = 'mamacos-screenshare-resolution'
const FRAMERATE_KEY = 'mamacos-screenshare-framerate'
const GAME_AUTO_KEY = 'mamacos-screenshare-game-auto'

interface ResolutionInfo {
  width: number
  height: number
  label: string
}

// TETO DE SEGURANÇA da captura de tela — bug relatado (Windows): compartilhar
// a TELA INTEIRA (ou uma janela em tela cheia) derrubava o processo de
// renderização ("processo travou — Motivo: crashed"), enquanto janelas
// menores funcionavam. O que essas duas escolhas têm em comum (e as janelas
// normais não) é o TAMANHO do quadro: sai do tamanho do monitor inteiro. Antes
// "Fonte" usava 7680x4320 como teto (= sem limite) e a fonte "screen:" era
// capturada sem limite nenhum; com isso quadros 4K / ultrawide / multi-monitor
// iam direto pro encoder H.264 (forçado em VoiceContext.tsx), que roda DENTRO
// do renderer quando cai no encoder por software (OpenH264) — e o H.264 nem
// suporta quadros acima do nível 5.2 (4096x2304). Agora NENHUMA captura passa
// de 2560x1440, qualquer que seja o preset ou o tipo de fonte.
export const SAFE_MAX_CAPTURE_WIDTH = 2560
export const SAFE_MAX_CAPTURE_HEIGHT = 1440

// Limite de tamanho de quadro do H.264 (nível 5.2: 36864 macroblocos — na
// prática 4096x2304). Acima disso encoders de hardware e o OpenH264 recusam
// ou quebram; ver VoiceContext.tsx (troca pra VP8 se a redução falhar).
export function exceedsH264FrameLimits(width: number, height: number): boolean {
  if (!width || !height) return false
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  return width > 4096 || height > 4096 || macroblocks > 36864
}

// Encaixa (width x height) dentro de (maxWidth x maxHeight) mantendo a
// proporção, sem nunca aumentar, e com dimensões PARES (encoders de vídeo
// com subamostragem 4:2:0 exigem largura/altura pares).
export function fitWithin(
  width: number,
  height: number,
  maxWidth = SAFE_MAX_CAPTURE_WIDTH,
  maxHeight = SAFE_MAX_CAPTURE_HEIGHT
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
  return { width: even(width * scale), height: even(height * scale) }
}

// "native" (Fonte) = a resolução da própria tela, mas limitada ao teto de
// segurança acima (monitores até 1440p saem nativos; 4K/ultrawide são
// reduzidos mantendo a proporção).
const RESOLUTIONS: Record<ScreenShareResolution, ResolutionInfo> = {
  '720p': { width: 1280, height: 720, label: '720p (HD)' },
  '1080p': { width: 1920, height: 1080, label: '1080p (Full HD)' },
  '1440p': { width: 2560, height: 1440, label: '1440p (2K)' },
  native: { width: SAFE_MAX_CAPTURE_WIDTH, height: SAFE_MAX_CAPTURE_HEIGHT, label: 'Fonte (nativa, até 1440p)' },
}

const RESOLUTION_OPTIONS: { value: ScreenShareResolution; label: string }[] = (
  Object.keys(RESOLUTIONS) as ScreenShareResolution[]
).map((value) => ({ value, label: RESOLUTIONS[value].label }))

const FRAME_RATE_OPTIONS: ScreenShareFrameRate[] = [15, 30, 60]

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
  // Antes 35Mbps (calibrado pra 4K/60) — como "Fonte" agora nunca passa
  // de 1440p (ver SAFE_MAX_CAPTURE_*), usa o mesmo patamar do 1440p com
  // uma folga pequena.
  native: { 15: 5_000_000, 30: 9_000_000, 60: 14_000_000 },
}

export interface QualityPreset {
  width: number
  height: number
  frameRate: number
  maxBitrate: number
  degradationPreference: 'maintain-framerate' | 'maintain-resolution'
  // Se `true`, `width`/`height` são um TETO de verdade (constraint
  // "max" no getDisplayMedia) — a tela é reduzida pra caber nesse
  // limite mesmo que a resolução nativa seja maior. Hoje é SEMPRE `true`
  // (ver SAFE_MAX_CAPTURE_* — "Fonte" deixou de ser "sem limite" porque
  // quadros do tamanho de um monitor 4K derrubavam o renderer).
  capResolution: boolean
  label: string
  description: string
  // true quando é o preset automático "Jogo" (ver buildGamePreset).
  isGamePreset?: boolean
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
    // Sempre um teto de verdade agora (ver SAFE_MAX_CAPTURE_*) — inclusive
    // em "Fonte", que antes era "sem limite".
    capResolution: true,
    label: `${res.label} · ${frameRate}fps`,
    description: isNative
      ? 'Transmite na resolução nativa da sua tela (até 1440p — telas maiores são reduzidas por segurança), no bitrate mais alto que dá.'
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

// ---------------------------------------------------------------------------
// Preset "Jogo" — aplicado AUTOMATICAMENTE quando a fonte escolhida é um
// jogo detectado (card "Jogo" do seletor / atalho do aviso "Jogando X"),
// se a opção "Qualidade automática para jogos" estiver ligada (padrão).
//
//  - 60fps sempre (jogo a 30fps parece travado pra quem assiste);
//  - 1080p60 a 7 Mbps — faixa recomendada pra 1080p60 em H.264 (6–8 Mbps);
//  - rede fraca (qualidade da SUA conexão "ruim"/"perdida") → 720p60 a
//    3,5 Mbps, pra não picotar;
//  - quem escolheu 1440p/"Fonte" nas configurações continua em 1440p60
//    (teto de segurança SAFE_MAX_CAPTURE_* nunca é ultrapassado);
//  - 'maintain-framerate': se a rede apertar, perde nitidez, não fluidez;
//  - contentHint 'motion' (vem de contentHintForPreset, frameRate 60).
// ---------------------------------------------------------------------------
const GAME_PRESET_BITRATE_1080P60 = 7_000_000
const GAME_PRESET_BITRATE_720P60 = 3_500_000

export function buildGamePreset(userPreset: Pick<QualityPreset, 'width' | 'height'>, opts: { weakNetwork: boolean }): QualityPreset {
  const base = {
    frameRate: 60,
    degradationPreference: 'maintain-framerate' as const,
    capResolution: true,
    isGamePreset: true,
  }
  if (opts.weakNetwork) {
    return {
      ...base,
      width: 1280,
      height: 720,
      maxBitrate: GAME_PRESET_BITRATE_720P60,
      label: 'Jogo · 720p60 (rede fraca)',
      description: 'Sua conexão está instável — transmitindo o jogo em 720p a 60fps pra não travar.',
    }
  }
  if (userPreset.width > 1920 || userPreset.height > 1080) {
    const width = Math.min(userPreset.width, SAFE_MAX_CAPTURE_WIDTH)
    const height = Math.min(userPreset.height, SAFE_MAX_CAPTURE_HEIGHT)
    return {
      ...base,
      width,
      height,
      maxBitrate: BITRATE_TABLE['1440p'][60],
      label: 'Jogo · 1440p60',
      description: 'Transmitindo o jogo em até 1440p a 60fps (a resolução alta que você escolheu).',
    }
  }
  return {
    ...base,
    width: 1920,
    height: 1080,
    maxBitrate: GAME_PRESET_BITRATE_1080P60,
    label: 'Jogo · 1080p60',
    description: 'Transmitindo o jogo em 1080p a 60fps, priorizando fluidez.',
  }
}

// Decide o preset EFETIVO de uma transmissão: o escolhido pela pessoa, ou
// o preset "Jogo" quando a fonte é um jogo detectado e o modo automático
// está ligado.
export function resolveScreenSharePreset(
  userPreset: QualityPreset,
  ctx: { isGame: boolean; gameAuto: boolean; weakNetwork: boolean }
): QualityPreset {
  if (!ctx.isGame || !ctx.gameAuto) return userPreset
  return buildGamePreset(userPreset, { weakNetwork: ctx.weakNetwork })
}

export function loadGameAutoPreset(): boolean {
  try {
    return localStorage.getItem(GAME_AUTO_KEY) !== 'false'
  } catch {
    return true
  }
}

// Exportadas (não só internas ao hook) pra permitir uma LEITURA somente-
// exibição do valor atual em lugares fora do VoiceProvider — ver
// ScreenSharePicker.tsx, que mostra "qualidade selecionada" antes de
// compartilhar mas não pode chamar useVoice() (ele existe fora do
// VoiceProvider, que só monta dentro do MainLayout).
function loadResolution(): ScreenShareResolution {
  try {
    const raw = localStorage.getItem(RESOLUTION_KEY)
    return raw === '720p' || raw === '1080p' || raw === '1440p' || raw === 'native' ? raw : '1080p'
  } catch {
    return '1080p'
  }
}

function loadFrameRate(): ScreenShareFrameRate {
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
  const [gameAuto, setGameAutoState] = useState<boolean>(loadGameAutoPreset)

  function setGameAuto(next: boolean) {
    setGameAutoState(next)
    try {
      localStorage.setItem(GAME_AUTO_KEY, String(next))
    } catch {
      // best-effort
    }
  }

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
    // Qualidade automática para jogos (preset "Jogo", ver buildGamePreset).
    gameAuto,
    setGameAuto,
    preset: buildPreset(resolution, frameRate),
  }
}
