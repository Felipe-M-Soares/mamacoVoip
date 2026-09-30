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

// CORS aberto (`*`) é aceitável AQUI porque a autenticação é feita
// pelo header Authorization (Bearer JWT do Supabase), nunca por cookie —
// um site de terceiros não consegue anexar o JWT de ninguém sozinho.
// O app desktop (Electron) roda em file:// / app://, sem origem fixa.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Todas as salas (canal de voz de servidor, grupo, DM) usam o UUID da
// linha correspondente no banco como nome — qualquer outra coisa é
// recusada ANTES de ir pro banco (evita consulta inútil com texto
// arbitrário e mensagens de erro de "invalid input syntax for uuid").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Teto de sanidade pro limite de participantes vindo do cliente (só
// usado em grupo/DM — canal de servidor usa o valor do BANCO, ver abaixo).
const MAX_CLIENT_USER_LIMIT = 100

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
  }
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
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new HttpError('Não autenticado.', 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Configuração do Supabase ausente no servidor.')

    // Valida o JWT do próprio Supabase (o mesmo que autentica o resto do
    // app) e usa o ID JÁ VERIFICADO como identidade no LiveKit — nunca
    // confia em nenhum userId que o corpo da requisição possa mandar.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    // DESEMPENHO: validar a sessão e ler o corpo em paralelo com as
    // consultas de acesso logo abaixo (as consultas já rodam com o JWT do
    // usuário e passam pela RLS, então não dependem do getUser()).
    const userPromise = supabase.auth.getUser()
    const body = await req.json().catch(() => ({}))
    const room = typeof body.room === 'string' ? body.room.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : undefined
    const clientUserLimit =
      typeof body.userLimit === 'number' && Number.isFinite(body.userLimit) && body.userLimit > 0
        ? Math.min(MAX_CLIENT_USER_LIMIT, Math.floor(body.userLimit))
        : null
    if (!room) throw new HttpError('Nome da sala ausente.', 400)
    if (!UUID_RE.test(room)) throw new HttpError('Nome da sala inválido.', 400)

    // TRIGÉSIMA NONA RODADA — bug de segurança CRÍTICO achado em
    // auditoria: até aqui, QUALQUER usuário autenticado que soubesse
    // (ou adivinhasse) o UUID de um canal de voz — inclusive alguém
    // EXPULSO/BANIDO daquele servidor, ou um estranho que nunca fez
    // parte da conversa — conseguia um token válido pra entrar na
    // chamada. A função validava QUEM é o usuário (identity = user.id
    // verificado, nunca confiando no cliente), mas nunca checava se
    // esse usuário tem o DIREITO de estar naquela sala específica.
    //
    // Correção: antes de emitir qualquer token, confirma que `room`
    // corresponde a um canal de servidor, grupo ou DM ao qual esse
    // usuário realmente pertence — reaproveitando a MESMA Row Level
    // Security que já protege essas tabelas no resto do app (o
    // `supabase` client aqui usa o JWT do próprio usuário, não a
    // service role, então cada SELECT abaixo já passa pela RLS de
    // verdade: se a linha não vier, é porque a RLS escondeu — usuário
    // não é membro do servidor daquele canal, ou não é
    // membro/participante daquele grupo/DM, incluindo o caso de ter
    // sido expulso/banido, que já remove a membership em
    // `server_members`). Sem duplicar a lógica de permissão em dois
    // lugares — a fonte de verdade continua sendo a RLS do banco.
    const [userRes, { data: channelRow }, { data: groupRow }, { data: dmRow }] = await Promise.all([
      userPromise,
      supabase.from('channels').select('id, server_id, type, user_limit, is_stage').eq('id', room).maybeSingle(),
      supabase.from('group_conversations').select('id').eq('id', room).maybeSingle(),
      supabase.from('dm_conversations').select('id').eq('id', room).maybeSingle(),
    ])
    const user = userRes.data.user
    if (userRes.error || !user) throw new HttpError('Sessão inválida ou expirada.', 401)
    if (!channelRow && !groupRow && !dmRow) {
      return jsonResponse({ error: 'Você não tem acesso a essa sala de voz.', code: 'not_authorized' }, 403)
    }
    // Grupo: exige ser MEMBRO agora. (Até a migration 007/parte 19 a RLS
    // de group_conversations também mostrava o grupo pra quem o CRIOU,
    // mesmo depois de sair — e isso bastava pra ganhar token da call.)
    // Checagem explícita além da RLS, falhando fechado.
    if (groupRow && !channelRow && !dmRow) {
      const { data: isMember, error: memberErr } = await supabase.rpc('is_group_member', {
        p_group_id: room,
        p_user_id: user.id,
      })
      if (memberErr || isMember !== true) {
        return jsonResponse({ error: 'Você não tem acesso a essa sala de voz.', code: 'not_authorized' }, 403)
      }
    }
    // Canal de TEXTO não vira sala de voz — antes qualquer canal que a
    // pessoa enxergasse (inclusive de texto) gerava um token válido.
    if (channelRow && channelRow.type !== 'voice') {
      return jsonResponse({ error: 'Esse canal não é um canal de voz.', code: 'not_voice_channel' }, 403)
    }

    // Limite de vagas: pra canal de SERVIDOR vem SEMPRE do banco
    // (channels.user_limit) — antes vinha do corpo da requisição, então
    // um cliente modificado podia simplesmente mandar `userLimit: 0` e
    // furar o limite do canal. Só grupo/DM (que não têm essa coluna)
    // continuam usando o valor do cliente, com um teto de sanidade.
    const userLimit = channelRow
      ? typeof channelRow.user_limit === 'number' && channelRow.user_limit > 0
        ? channelRow.user_limit
        : null
      : clientUserLimit

    const livekitUrl = Deno.env.get('LIVEKIT_URL')
    const apiKey = Deno.env.get('LIVEKIT_API_KEY')
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
    if (!livekitUrl || !apiKey || !apiSecret) {
      throw new Error(
        'LiveKit não configurado no servidor — defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET nas secrets da Edge Function.'
      )
    }

    // DESEMPENHO: as três checagens abaixo são independentes — antes rodavam
    // uma depois da outra (cada uma é uma ida ao banco ou ao LiveKit).
    //
    // 1) Canal "Palco" (is_stage): só quem pode moderar canais fala (mesma
    //    regra do cliente, via has_permission). Falha fechado.
    const stagePromise: Promise<boolean> = channelRow?.is_stage
      ? Promise.resolve(
          supabase.rpc('has_permission', {
            p_server_id: channelRow.server_id,
            p_user_id: user.id,
            p_permission: 'manage_channels',
          })
        ).then(({ data, error }) => !error && data === true, () => false)
      : Promise.resolve(true)

    // 2) Membro em castigo (timeout) entra só pra OUVIR. Falha fechado.
    //    (Quem já estava na sala na hora do castigo é tratado pela Edge
    //    Function livekit-moderate.)
    const notTimedOutPromise: Promise<boolean> = channelRow
      ? Promise.resolve(
          supabase.rpc('is_timed_out', { p_server_id: channelRow.server_id, p_user_id: user.id })
        ).then(({ data, error }) => !error && data !== true, () => false)
      : Promise.resolve(true)

    // 3) Limite de vagas contra a contagem REAL do LiveKit (fonte da
    //    verdade de quem está na sala). Se a sala ainda não existe no
    //    LiveKit (ninguém entrou), a chamada rejeita — não bloqueia a
    //    primeira pessoa.
    const roomFullPromise: Promise<boolean> = userLimit
      ? new RoomServiceClient(livekitUrl.replace(/^ws/, 'http'), apiKey, apiSecret)
          .listParticipants(room)
          .then(
            (participants) =>
              !participants.some((p) => p.identity === user.id) && participants.length >= userLimit,
            () => false
          )
      : Promise.resolve(false)

    const [stageOk, notTimedOut, roomFull] = await Promise.all([stagePromise, notTimedOutPromise, roomFullPromise])
    if (roomFull) {
      return jsonResponse({ error: 'A sala está cheia.', code: 'room_full' }, 403)
    }
    const canPublish = stageOk && notTimedOut

    const at = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name,
      // Token de vida curta — só precisa durar o suficiente pra
      // estabelecer a conexão WebSocket com o LiveKit logo em seguida;
      // reconectar mais tarde (ex.: depois de dormir o notebook) sempre
      // passa por aqui de novo e pega um token novo.
      // (O próprio servidor LiveKit renova o token da sessão já
      // conectada sozinho, então reconexões rápidas também funcionam.)
      ttl: '10m',
    })
    // Permissões MÍNIMAS: o app não usa data channel do LiveKit (o
    // soundboard vai pelo Realtime do Supabase) nem altera metadata do
    // participante — `canUpdateOwnMetadata` estava ligado com um
    // comentário errado (não tem nada a ver com reconexão) e foi
    // removido, junto com `canPublishData`.
    at.addGrant({
      room,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: false,
    })
    const token = await at.toJwt()

    return jsonResponse({ token, url: livekitUrl, canPublish })
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message, code: err.code }, err.status)
    }
    // Erro inesperado: detalhe só no log da função, nunca a mensagem crua.
    console.error('livekit-token:', err instanceof Error ? err.message : err)
    return jsonResponse({ error: 'Não foi possível entrar na sala de voz agora.' }, 500)
  }
})
