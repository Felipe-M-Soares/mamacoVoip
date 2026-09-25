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
  const { data, error } = await supabase.functions.invoke<LiveKitTokenResult & { error?: string; code?: string }>(
    'livekit-token',
    { body: params }
  )
  if (error) {
    throw new Error('Não foi possível conectar ao servidor de voz.')
  }
  if (!data || !data.token || !data.url) {
    if (data?.code === 'room_full') {
      const full = new Error('Esse canal de voz já está cheio.')
      full.name = 'RoomFullError'
      throw full
    }
    throw new Error(data?.error || 'Não foi possível conectar ao servidor de voz.')
  }
  return { token: data.token, url: data.url }
}
