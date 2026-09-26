import { supabase } from './supabase'

export async function exportUserData(userId: string) {
  const [profile, serverMemberships, friendships, messages, dmMessages, groupMessages] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('server_members').select('server_id, nickname, joined_at, servers(name)').eq('user_id', userId),
    supabase
      .from('friendships')
      .select('*')
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`),
    supabase.from('messages').select('content, channel_id, server_id, created_at').eq('author_id', userId).limit(5000),
    supabase.from('dm_messages').select('content, conversation_id, created_at').eq('author_id', userId).limit(5000),
    supabase.from('group_messages').select('content, group_id, created_at').eq('author_id', userId).limit(5000),
  ])

  const exportData = {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    server_memberships: serverMemberships.data,
    friendships: friendships.data,
    messages_in_servers: messages.data,
    direct_messages: dmMessages.data,
    group_messages: groupMessages.data,
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mamacos-voip-meus-dados-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
