// Edge Function: push-notify
//
// Chamada pelo PRÓPRIO banco (gatilho da PARTE 29 do SQL 007) quando uma
// mensagem nova é salva. Descobre quem deve ser avisado e manda a
// notificação pro celular pelo Firebase Cloud Messaging (FCM).
//
// Segurança:
//  - Só aceita chamadas com o segredo guardado em public.push_config
//    (o banco manda no cabeçalho x-push-secret) — ninguém de fora consegue
//    disparar notificações.
//  - Quem recebe é calculado aqui, com as regras do app: DM (sem
//    bloqueio), grupo (membros) e canal (só menção, respeitando "silenciar"
//    e nunca em canal restrito).
//
// Configuração: secret FCM_SERVICE_ACCOUNT (JSON da conta de serviço do
// Firebase) — ver docs/NOTIFICACOES.md. Publicar com --no-verify-jwt.

import { createClient } from 'npm:@supabase/supabase-js@2'

type Json = Record<string, unknown>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------- FCM (OAuth com a conta de serviço) ----------
type ServiceAccount = { client_email: string; private_key: string; project_id: string }
let cachedToken: { value: string; exp: number } | null = null

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  )
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const jwt = `${header}.${claims}.${b64url(sig)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!res.ok || !data.access_token) throw new Error(`OAuth do Firebase falhou (${res.status})`)
  cachedToken = { value: data.access_token, exp: now + (data.expires_in ?? 3600) }
  return data.access_token
}

function preview(content: string | null | undefined): string {
  const text = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return '📎 Enviou um anexo'
  return text.length > 140 ? `${text.slice(0, 137)}...` : text
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'método' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // --- Segredo do banco ---
  const { data: cfg } = await supabase.from('push_config').select('secret, enabled').eq('id', 1).maybeSingle()
  const given = req.headers.get('x-push-secret') ?? ''
  if (!cfg?.secret || !cfg.enabled || !timingSafeEqual(given, cfg.secret)) return json({ error: 'proibido' }, 403)

  const saRaw = Deno.env.get('FCM_SERVICE_ACCOUNT')
  if (!saRaw) return json({ skipped: 'FCM_SERVICE_ACCOUNT não configurado' })
  let sa: ServiceAccount
  try {
    sa = JSON.parse(saRaw)
  } catch {
    return json({ error: 'FCM_SERVICE_ACCOUNT inválido' }, 500)
  }

  const body = (await req.json().catch(() => null)) as { table?: string; id?: string } | null
  const table = body?.table
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id || !['messages', 'dm_messages', 'group_messages'].includes(table ?? '')) return json({ error: 'entrada' }, 400)

  let recipients: string[] = []
  let title = 'Mamacos Voip'
  let text = ''
  let data: Record<string, string> = {}
  let tag = ''

  const authorName = async (authorId: string) => {
    const { data: p } = await supabase.from('profiles').select('display_name, username').eq('id', authorId).maybeSingle()
    return (p?.display_name || p?.username || 'Alguém') as string
  }
  const blockedPairs = async (authorId: string, ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const { data: rows } = await supabase
      .from('blocked_users')
      .select('blocker_id, blocked_id')
      .or(`and(blocker_id.eq.${authorId},blocked_id.in.(${ids.join(',')})),and(blocked_id.eq.${authorId},blocker_id.in.(${ids.join(',')}))`)
    const out = new Set<string>()
    for (const r of rows ?? []) out.add(r.blocker_id === authorId ? r.blocked_id : r.blocker_id)
    return out
  }

  if (table === 'dm_messages') {
    const { data: m } = await supabase.from('dm_messages').select('author_id, content, conversation_id').eq('id', id).maybeSingle()
    if (!m) return json({ skipped: 'mensagem' })
    const { data: c } = await supabase.from('dm_conversations').select('user_a, user_b').eq('id', m.conversation_id).maybeSingle()
    if (!c) return json({ skipped: 'conversa' })
    const other = c.user_a === m.author_id ? c.user_b : c.user_a
    const blocked = await blockedPairs(m.author_id, [other])
    recipients = blocked.has(other) ? [] : [other]
    title = await authorName(m.author_id)
    text = preview(m.content)
    data = { kind: 'dm', id: m.conversation_id }
    tag = `dm-${m.conversation_id}`
  } else if (table === 'group_messages') {
    const { data: m } = await supabase.from('group_messages').select('author_id, content, group_id').eq('id', id).maybeSingle()
    if (!m) return json({ skipped: 'mensagem' })
    const [{ data: g }, { data: members }] = await Promise.all([
      supabase.from('group_conversations').select('name').eq('id', m.group_id).maybeSingle(),
      supabase.from('group_conversation_members').select('user_id').eq('group_id', m.group_id),
    ])
    const ids = (members ?? []).map((r) => r.user_id as string).filter((u) => u !== m.author_id)
    const blocked = await blockedPairs(m.author_id, ids)
    recipients = ids.filter((u) => !blocked.has(u))
    const who = await authorName(m.author_id)
    title = (g?.name as string) || 'Grupo'
    text = `${who}: ${preview(m.content)}`
    data = { kind: 'group', id: m.group_id }
    tag = `group-${m.group_id}`
  } else {
    const { data: m } = await supabase.from('messages').select('author_id, content, channel_id, server_id').eq('id', id).maybeSingle()
    if (!m) return json({ skipped: 'mensagem' })
    const names = [...new Set([...(m.content ?? '').matchAll(/@([A-Za-z0-9_.]{3,32})/g)].map((x) => x[1].toLowerCase()))].slice(0, 20)
    if (!names.length) return json({ skipped: 'sem menção' })
    const [{ data: ch }, { data: sv }] = await Promise.all([
      supabase.from('channels').select('name, is_restricted').eq('id', m.channel_id).maybeSingle(),
      supabase.from('servers').select('name').eq('id', m.server_id).maybeSingle(),
    ])
    if (!ch || ch.is_restricted) return json({ skipped: 'canal' })
    const { data: profs } = await supabase.from('profiles').select('id, username').in('username', names)
    // Comparação sem maiúsculas (o filtro "in" acima já pega o exato; isto
    // cobre "@Fulano" vs "fulano").
    let ids = (profs ?? []).map((p) => p.id as string)
    if (ids.length < names.length) {
      const { data: more } = await supabase.from('profiles').select('id, username').or(names.map((n) => `username.ilike.${n}`).join(','))
      ids = [...new Set([...ids, ...(more ?? []).filter((p) => names.includes(String(p.username).toLowerCase())).map((p) => p.id as string)])]
    }
    ids = ids.filter((u) => u !== m.author_id)
    if (!ids.length) return json({ skipped: 'ninguém' })
    const [{ data: members }, { data: mutes }] = await Promise.all([
      supabase.from('server_members').select('user_id').eq('server_id', m.server_id).in('user_id', ids),
      supabase.from('channel_mutes').select('user_id, mentions_only').eq('channel_id', m.channel_id).in('user_id', ids),
    ])
    const memberSet = new Set((members ?? []).map((r) => r.user_id as string))
    const fullyMuted = new Set((mutes ?? []).filter((r) => !r.mentions_only).map((r) => r.user_id as string))
    const blocked = await blockedPairs(m.author_id, ids)
    recipients = ids.filter((u) => memberSet.has(u) && !fullyMuted.has(u) && !blocked.has(u))
    const who = await authorName(m.author_id)
    title = `${who} em #${ch.name}`
    text = `${(sv?.name as string) ?? 'Servidor'} · ${preview(m.content)}`
    data = { kind: 'channel', id: m.channel_id, serverId: m.server_id }
    tag = `ch-${m.channel_id}`
  }

  if (!recipients.length) return json({ sent: 0 })
  const { data: tokens } = await supabase.from('push_tokens').select('token').in('user_id', recipients)
  if (!tokens?.length) return json({ sent: 0 })

  const bearer = await accessToken(sa)
  let sent = 0
  const dead: string[] = []
  await Promise.all(
    tokens.map(async ({ token }) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: text },
            data,
            android: {
              priority: 'HIGH',
              notification: { channel_id: 'mensagens', tag, icon: 'ic_stat_mamaco', color: '#E11D48' },
            },
          },
        }),
      })
      if (res.ok) {
        sent++
        return
      }
      const err = (await res.json().catch(() => ({}))) as Json
      const code = JSON.stringify(err)
      if (res.status === 404 || code.includes('UNREGISTERED') || code.includes('INVALID_ARGUMENT')) dead.push(token as string)
      else console.error('FCM falhou', res.status, code.slice(0, 300))
    })
  )
  if (dead.length) await supabase.from('push_tokens').delete().in('token', dead)
  return json({ sent, removed: dead.length })
})
