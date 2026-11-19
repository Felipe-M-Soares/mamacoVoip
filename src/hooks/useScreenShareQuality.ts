import { useState } from 'react'

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

export const SAFE_MAX_CAPTURE_WIDTH = 2560
export const SAFE_MAX_CAPTURE_HEIGHT = 1440

export function exceedsH264FrameLimits(width: number, height: number): boolean {
  if (!width || !height) return false
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  return width > 4096 || height > 4096 || macroblocks > 36864
}

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

const BITRATE_TABLE: Record<ScreenShareResolution, Record<ScreenShareFrameRate, number>> = {
  '720p': { 15: 1_200_000, 30: 2_500_000, 60: 4_000_000 },
  '1080p': { 15: 2_500_000, 30: 4_000_000, 60: 6_000_000 },
  '1440p': { 15: 4_500_000, 30: 8_000_000, 60: 12_000_000 },
  native: { 15: 5_000_000, 30: 9_000_000, 60: 14_000_000 },
}

export interface QualityPreset {
  width: number
  height: number
  frameRate: number
  maxBitrate: number
  degradationPreference: 'maintain-framerate' | 'maintain-resolution'
  capResolution: boolean
  label: string
  description: string
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
    degradationPreference: isNative ? 'maintain-resolution' : 'maintain-framerate',
    capResolution: true,
    label: `${res.label} · ${frameRate}fps`,
    description: isNative
      ? 'Transmite na resolução nativa da sua tela (até 1440p — telas maiores são reduzidas por segurança), no bitrate mais alto que dá.'
      : `Resolução fixa em ${res.label}, ${frameRate} quadros por segundo.`,
  }
}

export function contentHintForPreset(preset: Pick<QualityPreset, 'frameRate'>): 'detail' | 'motion' {
  return preset.frameRate <= 15 ? 'detail' : 'motion'
}

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
    }
  }

  function setResolution(next: ScreenShareResolution) {
    setResolutionState(next)
    try {
      localStorage.setItem(RESOLUTION_KEY, next)
    } catch {
    }
  }

  function setFrameRate(next: ScreenShareFrameRate) {
    setFrameRateState(next)
    try {
      localStorage.setItem(FRAMERATE_KEY, String(next))
    } catch {
    }
  }

  return {
    resolution,
    setResolution,
    frameRate,
    setFrameRate,
    resolutionOptions: RESOLUTION_OPTIONS,
    frameRateOptions: FRAME_RATE_OPTIONS,
    gameAuto,
    setGameAuto,
    preset: buildPreset(resolution, frameRate),
  }
}
