import { FunctionsHttpError } from '@supabase/supabase-js'
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
  >('livekit-token', { body: params })
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
