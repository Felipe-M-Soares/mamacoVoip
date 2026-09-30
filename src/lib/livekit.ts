import { FunctionRegion, FunctionsHttpError } from '@supabase/supabase-js'
import type { Room } from 'livekit-client'
import { supabase } from './supabase'

// Sala/transmissão de voz e vídeo migrou de um mesh manual de
// RTCPeerConnection (um por peer, sinalização via Supabase Realtime) pra
// um SFU de verdade (LiveKit): cada participante manda sua mídia UMA vez
// pro servidor LiveKit, que redistribui pra todo mundo — em vez de cada
// participante mandar N cópias (uma por peer) e o upload dele
// multiplicar por N igual antes. Isso é o que permite salas com bem mais
// gente sem o upload de ninguém explodir, e no meio do caminho elimina
// toda a sinalização manual (oferta/resposta/ICE, "quem está
// compartilhando tela" via broadcast próprio) — o LiveKit já resolve
// isso tudo sozinho, incluindo marcar nativamente qual track é
// microfone/câmera/tela (ver Track.Source em VoiceContext.tsx), sem
// precisar de nenhum acordo próprio tipo o antigo `screen-meta`.
//
// O par de credenciais (API key/secret) do LiveKit nunca pode chegar
// perto do código do cliente — só o token de acesso, de vida curta,
// assinado do lado do servidor (ver supabase/functions/livekit-token) já
// com a identidade do usuário JÁ autenticado travada nele.

// Região da Edge Function do token (opcional, VITE_SUPABASE_REGION, ex.:
// "sa-east-1"). Por padrão a função roda no ponto mais perto de QUEM CHAMA;
// como ela faz várias consultas ao banco, rodar na MESMA região do banco
// economiza uma ida-e-volta intercontinental por consulta quando o banco
// não está perto do usuário. Ver docs/PING.md.
const FUNCTIONS_REGION: FunctionRegion | undefined = (() => {
  const raw = (import.meta.env.VITE_SUPABASE_REGION as string | undefined)?.trim()
  return raw && (Object.values(FunctionRegion) as string[]).includes(raw) ? (raw as FunctionRegion) : undefined
})()

export interface LiveKitTokenResult {
  token: string
  url: string
  // `false` quando o servidor negou publicação (ex.: ouvinte num canal
  // "Palco") — o cliente entra só pra ouvir, sem publicar microfone.
  canPublish: boolean
}

// Extrai a mensagem de erro REAL que a Edge Function mandou (o corpo
// JSON `{ error: "..." }`, definido em supabase/functions/livekit-token)
// em vez de deixar só um "Edge Function returned a non-2xx status code"
// genérico — isso é o que torna um problema de configuração (secret
// faltando, função não publicada, LiveKit fora do ar) diagnosticável
// pela mensagem de erro sozinha, sem precisar abrir o DevTools.
async function extractFunctionError(error: unknown): Promise<{ message: string | null; code: string | null }> {
  if (!(error instanceof FunctionsHttpError)) return { message: null, code: null }
  try {
    const body = await error.context.clone().json()
    return {
      message: body && typeof body.error === 'string' ? body.error : null,
      code: body && typeof body.code === 'string' ? body.code : null,
    }
  } catch {
    // corpo não era JSON, ou já foi consumido — sem problema, cai no genérico
  }
  return { message: null, code: null }
}

// Pede um token de acesso pra uma sala específica (o `channelId`, igual
// já era usado como tópico do canal Realtime de sinalização antes —
// mantém a mesma convenção de nomes de sala, sem precisar mudar nada
// mais no resto do app). `userLimit` (quando maior que zero) é checado
// do lado do servidor contra quem JÁ está na sala segundo o próprio
// LiveKit — ver o comentário grande na Edge Function pro porquê disso
// ser mais confiável do que a checagem antiga, feita no cliente.
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
    // Compara pelo `code` (estável) e, por compatibilidade com uma Edge
    // Function antiga ainda publicada, também pela mensagem.
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
  // Edge Function antiga (sem o campo) sempre permitia publicar.
  return { token: data.token, url: data.url, canPublish: data.canPublish !== false }
}

export type VoiceModerationAction = 'kick' | 'ban' | 'timeout' | 'move'

/**
 * Depois de expulsar/banir/silenciar alguém, tira a pessoa das salas de
 * voz do servidor (ou corta o microfone, no timeout) direto no LiveKit —
 * sem isso, quem já estava conectado continuava falando até o token
 * expirar. Edge Function `livekit-moderate` (confere a permissão do
 * moderador no banco). Best-effort: nunca lança, só avisa no console.
 */
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

// ---------------------------------------------------------------------
// Conexão mais rápida / ping real (ver docs/PING.md)
// ---------------------------------------------------------------------

const LIVEKIT_URL_STORAGE_KEY = 'mamacos:livekit-url'

/** Guarda a URL do LiveKit (vem no token) pra pré-aquecer na próxima abertura do app. */
export function rememberLiveKitUrl(url: string) {
  try {
    if (/^wss?:\/\//.test(url)) localStorage.setItem(LIVEKIT_URL_STORAGE_KEY, url)
  } catch {
    // armazenamento bloqueado — só perde o pré-aquecimento
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

/**
 * Pré-aquece DNS + TLS com o servidor de voz logo que o app abre, usando a
 * URL da última call (não há token ainda, então é só isso — a escolha da
 * região acontece no `prepareConnection(url, token)` do join). Uma vez por
 * sessão; nunca lança.
 */
let prewarmed = false
export function prewarmLiveKitConnection(prepare: (url: string) => Promise<void>) {
  if (prewarmed) return
  const url = rememberedLiveKitUrl()
  if (!url) return
  prewarmed = true
  void prepare(url).catch(() => {})
}

/**
 * Sala LiveKit ativa (a da call atual), pra quem só precisa LER
 * estatísticas dela (ex.: o ping real em useVoiceMediaRtt) sem passar a
 * sala inteira por contexto React. Quem manda é o VoiceContext.
 */
let activeVoiceRoom: Room | null = null
export function setActiveVoiceRoom(room: Room | null) {
  activeVoiceRoom = room
}
export function getActiveVoiceRoom(): Room | null {
  return activeVoiceRoom
}

// Pré-busca do token ao passar o mouse/focar num canal de voz: quando a
// pessoa clica, o pedido (Edge Function, que pode estar "fria") já foi
// feito. Uso único e vida curta (o limite de vagas é conferido na hora
// do pedido; 45s mantém isso praticamente atual).
const PREFETCH_TTL_MS = 45_000
const prefetchedTokens = new Map<string, { at: number; userLimit: number; promise: Promise<LiveKitTokenResult> }>()

export function prefetchLiveKitToken(room: string, userLimit = 0) {
  const cached = prefetchedTokens.get(room)
  if (cached && Date.now() - cached.at < PREFETCH_TTL_MS) return
  const promise = fetchLiveKitToken({ room, userLimit })
  // Falhou → some do cache (a entrada de verdade pede de novo).
  promise.catch(() => {
    if (prefetchedTokens.get(room)?.promise === promise) prefetchedTokens.delete(room)
  })
  prefetchedTokens.set(room, { at: Date.now(), userLimit, promise })
}

/** Token pré-buscado (se ainda válido) ou um pedido novo. */
export function takeLiveKitToken(room: string, userLimit = 0): Promise<LiveKitTokenResult> {
  const cached = prefetchedTokens.get(room)
  prefetchedTokens.delete(room)
  if (cached && cached.userLimit === userLimit && Date.now() - cached.at < PREFETCH_TTL_MS) {
    return cached.promise.catch(() => fetchLiveKitToken({ room, userLimit }))
  }
  return fetchLiveKitToken({ room, userLimit })
}
