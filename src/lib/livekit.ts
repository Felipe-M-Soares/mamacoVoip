import { FunctionRegion, FunctionsHttpError } from '@supabase/supabase-js'
import type { Room } from 'livekit-client'
import { supabase } from './supabase'

const FUNCTIONS_REGION: FunctionRegion | undefined = (() => {
  const raw = (import.meta.env.VITE_SUPABASE_REGION as string | undefined)?.trim()
  return raw && (Object.values(FunctionRegion) as string[]).includes(raw) ? (raw as FunctionRegion) : undefined
})()

export interface LiveKitTokenResult {
  token: string
  url: string
  canPublish: boolean
}

async function extractFunctionError(error: unknown): Promise<{ message: string | null; code: string | null }> {
  if (!(error instanceof FunctionsHttpError)) return { message: null, code: null }
  try {
    const body = await error.context.clone().json()
    return {
      message: body && typeof body.error === 'string' ? body.error : null,
      code: body && typeof body.code === 'string' ? body.code : null,
    }
  } catch {
  }
  return { message: null, code: null }
}

export async function fetchLiveKitToken(params: {
  room: string
  name?: string
  userLimit?: number
}): Promise<LiveKitTokenResult> {
  const { data, error } = await supabase.functions.invoke<
    Omit<LiveKitTokenResult, 'canPublish'> & { canPublish?: boolean; error?: string; code?: string }
  >('livekit-token', { body: params, ...(FUNCTIONS_REGION ? { region: FUNCTIONS_REGION } : {}) })
  if (error) {
    const { message: detail, code } = await extractFunctionError(error)
    if (code === 'room_full' || detail === 'A sala está cheia.') {
      const full = new Error(detail ?? 'Esse canal de voz já está cheio.')
      full.name = 'RoomFullError'
      throw full
    }
    throw new Error(detail || `Não foi possível conectar ao servidor de voz (${error.message}).`)
  }
  if (!data || !data.token || !data.url) {
    if (data?.code === 'room_full') {
      const full = new Error('Esse canal de voz já está cheio.')
      full.name = 'RoomFullError'
      throw full
    }
    throw new Error(data?.error || 'Não foi possível conectar ao servidor de voz.')
  }
  return { token: data.token, url: data.url, canPublish: data.canPublish !== false }
}

export type VoiceModerationAction = 'kick' | 'ban' | 'timeout' | 'move'

export async function moderateVoiceParticipant(params: {
  serverId: string
  userId: string
  action: VoiceModerationAction
}): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('livekit-moderate', {
      body: { server_id: params.serverId, user_id: params.userId, action: params.action },
    })
    if (error) {
      const { message } = await extractFunctionError(error)
      console.warn('[livekit-moderate]', message ?? error.message)
    }
  } catch (err) {
    console.warn('[livekit-moderate]', err)
  }
}

const LIVEKIT_URL_STORAGE_KEY = 'mamacos:livekit-url'

export function rememberLiveKitUrl(url: string) {
  try {
    if (/^wss?:\/\//.test(url)) localStorage.setItem(LIVEKIT_URL_STORAGE_KEY, url)
  } catch {
  }
}

function rememberedLiveKitUrl(): string | null {
  try {
    const url = localStorage.getItem(LIVEKIT_URL_STORAGE_KEY)
    return url && /^wss?:\/\//.test(url) ? url : null
  } catch {
    return null
  }
}

let prewarmed = false
export function prewarmLiveKitConnection(prepare: (url: string) => Promise<void>) {
  if (prewarmed) return
  const url = rememberedLiveKitUrl()
  if (!url) return
  prewarmed = true
  void prepare(url).catch(() => {})
}

let activeVoiceRoom: Room | null = null
export function setActiveVoiceRoom(room: Room | null) {
  activeVoiceRoom = room
}
export function getActiveVoiceRoom(): Room | null {
  return activeVoiceRoom
}

const PREFETCH_TTL_MS = 45_000
const prefetchedTokens = new Map<string, { at: number; userLimit: number; promise: Promise<LiveKitTokenResult> }>()

export function prefetchLiveKitToken(room: string, userLimit = 0) {
  const cached = prefetchedTokens.get(room)
  if (cached && Date.now() - cached.at < PREFETCH_TTL_MS) return
  const promise = fetchLiveKitToken({ room, userLimit })
  promise.catch(() => {
    if (prefetchedTokens.get(room)?.promise === promise) prefetchedTokens.delete(room)
  })
  prefetchedTokens.set(room, { at: Date.now(), userLimit, promise })
}

export function takeLiveKitToken(room: string, userLimit = 0): Promise<LiveKitTokenResult> {
  const cached = prefetchedTokens.get(room)
  prefetchedTokens.delete(room)
  if (cached && cached.userLimit === userLimit && Date.now() - cached.at < PREFETCH_TTL_MS) {
    return cached.promise.catch(() => fetchLiveKitToken({ room, userLimit }))
  }
  return fetchLiveKitToken({ room, userLimit })
}
