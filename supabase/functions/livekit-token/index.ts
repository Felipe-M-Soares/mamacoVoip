import { createClient } from 'npm:@supabase/supabase-js@2'
import { AccessToken, RoomServiceClient } from 'npm:livekit-server-sdk@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
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
    if (groupRow && !channelRow && !dmRow) {
      const { data: isMember, error: memberErr } = await supabase.rpc('is_group_member', {
        p_group_id: room,
        p_user_id: user.id,
      })
      if (memberErr || isMember !== true) {
        return jsonResponse({ error: 'Você não tem acesso a essa sala de voz.', code: 'not_authorized' }, 403)
      }
    }
    if (dmRow && !channelRow && !groupRow) {
      const { data: canJoin, error: dmErr } = await supabase.rpc('can_access_voice_room', { p_room: room })
      if (dmErr || canJoin !== true) {
        return jsonResponse({ error: 'Não dá pra ligar pra essa pessoa.', code: 'not_authorized' }, 403)
      }
    }
    if (channelRow && channelRow.type !== 'voice') {
      return jsonResponse({ error: 'Esse canal não é um canal de voz.', code: 'not_voice_channel' }, 403)
    }

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

    const stagePromise: Promise<boolean> = channelRow?.is_stage
      ? Promise.resolve(
          supabase.rpc('has_permission', {
            p_server_id: channelRow.server_id,
            p_user_id: user.id,
            p_permission: 'manage_channels',
          })
        ).then(({ data, error }) => !error && data === true, () => false)
      : Promise.resolve(true)

    const notTimedOutPromise: Promise<boolean> = channelRow
      ? Promise.resolve(
          supabase.rpc('is_timed_out', { p_server_id: channelRow.server_id, p_user_id: user.id })
        ).then(({ data, error }) => !error && data !== true, () => false)
      : Promise.resolve(true)

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
      ttl: '10m',
    })
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
    console.error('livekit-token:', err instanceof Error ? err.message : err)
    return jsonResponse({ error: 'Não foi possível entrar na sala de voz agora.' }, 500)
  }
})
