// Edge Function: livekit-token
//
// Emite o token de acesso (JWT) que o cliente usa pra conectar numa sala
// do LiveKit (ver src/lib/livekit.ts e src/context/VoiceContext.tsx).
//
// Isso PRECISA passar por um servidor — o par API key/secret do LiveKit
// dá permissão de criar qualquer sala/identidade, então nunca pode ir
// pro código do cliente (app desktop, navegador, app mobile), onde
// qualquer pessoa poderia extrair e se passar por qualquer usuário. Aqui
// (Supabase Edge Function, roda só no servidor) o segredo fica seguro, e
// a identidade do token é sempre travada no usuário JÁ autenticado que
// fez o pedido — nunca no que o cliente manda no corpo da requisição.
//
// Variáveis de ambiente necessárias (configurar em Project Settings >
// Edge Functions > Secrets no dashboard do Supabase, ou via
// `supabase secrets set`):
//   LIVEKIT_URL          — URL do seu servidor LiveKit (wss://...),
//                          tanto faz se é LiveKit Cloud ou auto-hospedado
//   LIVEKIT_API_KEY       — API key do projeto/servidor LiveKit
//   LIVEKIT_API_SECRET    — API secret correspondente
// SUPABASE_URL e SUPABASE_ANON_KEY já existem automaticamente em toda
// Edge Function do Supabase, não precisa configurar.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { AccessToken, RoomServiceClient } from 'npm:livekit-server-sdk@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Não autenticado.')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Configuração do Supabase ausente no servidor.')

    // Valida o JWT do próprio Supabase (o mesmo que autentica o resto do
    // app) e usa o ID JÁ VERIFICADO como identidade no LiveKit — nunca
    // confia em nenhum userId que o corpo da requisição possa mandar.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) throw new Error('Sessão inválida ou expirada.')

    const body = await req.json().catch(() => ({}))
    const room = typeof body.room === 'string' ? body.room.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : undefined
    const userLimit = typeof body.userLimit === 'number' && body.userLimit > 0 ? Math.floor(body.userLimit) : null
    if (!room) throw new Error('Nome da sala ausente.')
    // Mesmo limite de tamanho de tópico usado pelo Realtime (voice:<id>)
    // — só uma validação básica de sanidade, não deixa criar uma sala com
    // um nome absurdamente grande ou vazio.
    if (room.length > 200) throw new Error('Nome da sala inválido.')

    const livekitUrl = Deno.env.get('LIVEKIT_URL')
    const apiKey = Deno.env.get('LIVEKIT_API_KEY')
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
    if (!livekitUrl || !apiKey || !apiSecret) {
      throw new Error(
        'LiveKit não configurado no servidor — defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET nas secrets da Edge Function.'
      )
    }

    // Limite de participantes do canal (vem da coluna channels.user_limit,
    // ou de options.userLimit pra chamada de DM/grupo — ver join() em
    // VoiceContext.tsx) — checado aqui, do lado do servidor, contra a
    // contagem REAL de participantes que o próprio LiveKit já tem pra
    // essa sala agora. Isso substitui a checagem antiga (feita no
    // cliente, via ordenação de presence do Realtime) por uma
    // autoritativa e sem corrida: o LiveKit é a fonte da verdade de quem
    // está OU NÃO na sala, não uma contagem que cada cliente calcula por
    // conta própria.
    if (userLimit) {
      try {
        const roomService = new RoomServiceClient(livekitUrl.replace(/^ws/, 'http'), apiKey, apiSecret)
        const participants = await roomService.listParticipants(room)
        const alreadyIn = participants.some((p) => p.identity === user.id)
        if (!alreadyIn && participants.length >= userLimit) {
          return jsonResponse({ error: 'A sala está cheia.', code: 'room_full' }, 403)
        }
      } catch {
        // A sala pode simplesmente não existir ainda no servidor LiveKit
        // (ninguém entrou nela ainda) — a chamada do RoomService rejeita
        // nesse caso, mas isso não é motivo pra bloquear quem está
        // tentando ser a PRIMEIRA pessoa a entrar.
      }
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name,
      // Token de vida curta — só precisa durar o suficiente pra
      // estabelecer a conexão WebSocket com o LiveKit logo em seguida;
      // reconectar mais tarde (ex.: depois de dormir o notebook) sempre
      // passa por aqui de novo e pega um token novo.
      ttl: '10m',
    })
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Permite recuperar a inscrição sozinho depois de uma queda breve
      // de rede sem precisar pedir um token novo no meio do caminho.
      canUpdateOwnMetadata: true,
    })
    const token = await at.toJwt()

    return jsonResponse({ token, url: livekitUrl })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Erro desconhecido' }, 400)
  }
})
