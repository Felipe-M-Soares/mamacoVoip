// Edge Function: livekit-moderate
//
// Aplica no LiveKit o efeito de uma moderação que JÁ aconteceu no banco
// (kick_member / ban_member / timeout_member / move_voice_member). Sem
// isso, quem já estava numa sala de voz continuava falando depois de ser
// expulso/banido/silenciado — o token do LiveKit (livekit-token) só é
// checado na ENTRADA, e o servidor LiveKit renova a sessão sozinho.
//
// Corpo: { server_id, user_id, action: 'kick' | 'ban' | 'timeout' | 'move', to_channel_id? }
// Autenticação: JWT do MODERADOR (header Authorization). A permissão é
// conferida no banco com my_permissions (kick_members / ban_members /
// timeout_members / move_members; recusa sessão sem o 2FA exigido), e o
// estado da moderação também:
//   * kick    → o alvo NÃO pode mais ser membro do servidor;
//   * ban     → o alvo precisa estar em `bans` daquele servidor;
//   * timeout → o alvo precisa estar em castigo agora (is_timed_out);
//   * move    → o alvo abaixo do moderador na hierarquia; tira a pessoa
//               de todas as salas do servidor EXCETO `to_channel_id`
//               (se informado). O app não chama essa ação hoje — o
//               "mover" normal é feito pelo próprio app do alvo (014);
//               ela existe pra forçar a saída de um cliente que ignora
//               o pedido.
// Assim ninguém usa esta função pra derrubar da voz quem não foi de fato
// moderado (ex.: alguém de cargo acima do seu).
//
// Ação no LiveKit: kick/ban/move → removeParticipant em cada sala de voz
// do servidor (sala = id do canal); timeout → updateParticipant com
// canPublish=false (continua ouvindo, igual ao livekit-token).
//
// Variáveis: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (as mesmas
// da livekit-token). SUPABASE_URL, SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.
// Publicar: `supabase functions deploy livekit-moderate`.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { RoomServiceClient } from 'npm:livekit-server-sdk@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Action = 'kick' | 'ban' | 'timeout' | 'move'
const PERMISSION_FOR: Record<Action, string> = {
  kick: 'kick_members',
  ban: 'ban_members',
  timeout: 'timeout_members',
  move: 'move_members',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Configuração do Supabase ausente no servidor.')

    // Cliente COM o JWT do moderador: identidade e permissão vêm daqui
    // (inclusive a exigência de 2FA das RPCs/RLS).
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
      error: userErr,
    } = await asUser.auth.getUser()
    if (userErr || !user) return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401)

    const body = await req.json().catch(() => ({}))
    const serverId = typeof body.server_id === 'string' ? body.server_id : ''
    const targetId = typeof body.user_id === 'string' ? body.user_id : ''
    const action = body.action as Action
    const toChannelId = typeof body.to_channel_id === 'string' ? body.to_channel_id : null
    if (!UUID_RE.test(serverId) || !UUID_RE.test(targetId) || !(action in PERMISSION_FOR)) {
      return jsonResponse({ error: 'Parâmetros inválidos.' }, 400)
    }
    if (toChannelId !== null && !UUID_RE.test(toChannelId)) {
      return jsonResponse({ error: 'Canal de destino inválido.' }, 400)
    }
    if (targetId === user.id && action !== 'move') {
      return jsonResponse({ error: 'Ação inválida sobre si mesmo.' }, 400)
    }

    // my_permissions (migration 007) devolve as permissões EFETIVAS de
    // quem chamou e RECUSA a chamada se a conta tem 2FA e esta sessão
    // ainda não passou pelo código (aal1) — mesma regra das RPCs de
    // moderação. Antes usávamos has_permission, que não olha o 2FA: com
    // só a senha de um moderador dava pra derrubar gente da voz ('move').
    const { data: perms, error: permErr } = await asUser.rpc('my_permissions', { p_server_id: serverId })
    if (permErr) {
      const needsMfa = /duas etapas/i.test(permErr.message ?? '')
      return jsonResponse(
        needsMfa
          ? { error: 'Confirme a verificação em duas etapas primeiro.', code: 'mfa_required' }
          : { error: 'Você não tem permissão para isso.', code: 'forbidden' },
        403
      )
    }
    const permList: string[] = Array.isArray(perms) ? perms.filter((p): p is string => typeof p === 'string') : []
    if (!permList.includes('administrator') && !permList.includes(PERMISSION_FOR[action])) {
      return jsonResponse({ error: 'Você não tem permissão para isso.', code: 'forbidden' }, 403)
    }

    // Service role só pra LER estado (quem é membro, banido, canais de
    // voz — inclusive restritos que o moderador talvez não enxergue).
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // Confere que a moderação de fato aconteceu no banco.
    if (action === 'kick' || action === 'ban') {
      const { data: member } = await admin
        .from('server_members')
        .select('user_id')
        .eq('server_id', serverId)
        .eq('user_id', targetId)
        .maybeSingle()
      if (member) return jsonResponse({ error: 'Essa pessoa ainda é membro do servidor.', code: 'not_moderated' }, 409)
      if (action === 'ban') {
        const { data: ban } = await admin
          .from('bans')
          .select('user_id')
          .eq('server_id', serverId)
          .eq('user_id', targetId)
          .maybeSingle()
        if (!ban) return jsonResponse({ error: 'Essa pessoa não está banida.', code: 'not_moderated' }, 409)
      }
    } else if (action === 'timeout') {
      const { data: timedOut } = await admin.rpc('is_timed_out', { p_server_id: serverId, p_user_id: targetId })
      if (timedOut !== true) return jsonResponse({ error: 'Essa pessoa não está silenciada.', code: 'not_moderated' }, 409)
    } else if (action === 'move' && targetId !== user.id) {
      const [{ data: targetPos }, { data: myPos }] = await Promise.all([
        asUser.rpc('top_role_position', { p_server_id: serverId, p_user_id: targetId }),
        asUser.rpc('top_role_position', { p_server_id: serverId, p_user_id: user.id }),
      ])
      if (typeof targetPos !== 'number' || typeof myPos !== 'number' || targetPos >= myPos) {
        return jsonResponse({ error: 'Você não pode mover alguém com cargo igual ou superior ao seu.' }, 403)
      }
    }

    const { data: voiceChannels, error: chErr } = await admin
      .from('channels')
      .select('id')
      .eq('server_id', serverId)
      .eq('type', 'voice')
    if (chErr) throw new Error('Não foi possível listar os canais de voz.')

    const livekitUrl = Deno.env.get('LIVEKIT_URL')
    const apiKey = Deno.env.get('LIVEKIT_API_KEY')
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
    if (!livekitUrl || !apiKey || !apiSecret) throw new Error('LiveKit não configurado no servidor.')
    const roomService = new RoomServiceClient(livekitUrl.replace(/^ws/, 'http'), apiKey, apiSecret)

    const rooms = (voiceChannels ?? []).map((c: { id: string }) => c.id).filter((id: string) => id !== toChannelId)
    let affected = 0
    await Promise.all(
      rooms.map(async (room: string) => {
        try {
          if (action === 'timeout') {
            await roomService.updateParticipant(room, targetId, undefined, {
              canPublish: false,
              canSubscribe: true,
              canPublishData: false,
            })
          } else {
            await roomService.removeParticipant(room, targetId)
          }
          affected++
        } catch {
          // A pessoa não está nessa sala (ou a sala nem existe) — normal.
        }
      })
    )

    return jsonResponse({ ok: true, affected })
  } catch (err) {
    // Detalhe só no log da função — nunca a mensagem crua pro cliente
    // (pode vazar configuração/infra).
    console.error('livekit-moderate:', err instanceof Error ? err.message : err)
    return jsonResponse({ error: 'Não foi possível aplicar a moderação na voz agora.' }, 500)
  }
})
