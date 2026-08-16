import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { supabase } from '../../lib/supabase'
import { useServerMembers } from '../../hooks/useServerMembers'
import type { Channel, Message } from '../../types/database'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function SearchModal({
  serverId,
  channels,
  onClose,
  onJumpToChannel,
}: {
  serverId: string
  channels: Channel[]
  onClose: () => void
  onJumpToChannel: (channel: Channel) => void
}) {
  const { members } = useServerMembers(serverId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const profileById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const channelById = Object.fromEntries(channels.map((c) => [c.id, c]))

  async function handleSearch() {
    const trimmed = query.trim()
    if (trimmed.length < 2) return
    setLoading(true)
    setSearched(true)
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('server_id', serverId)
      .ilike('content', `%${trimmed}%`)
      .order('created_at', { ascending: false })
      .limit(50)
    setResults(data ?? [])
    setLoading(false)
  }

  return (
    <Modal title="Pesquisar mensagens" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Buscar neste servidor..."
          autoFocus
          className="flex-1 px-3 py-2.5 rounded bg-discord-darker text-discord-text border-none outline-none focus:ring-2 focus:ring-discord-blurple text-sm"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2.5 rounded btn-primary text-sm shrink-0"
        >
          Buscar
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : searched && results.length === 0 ? (
        <p className="text-sm text-discord-text-muted">Nenhuma mensagem encontrada.</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {results.map((message) => {
            const author = profileById[message.author_id]
            const channel = channelById[message.channel_id]
            return (
              <button
                key={message.id}
                onClick={() => {
                  if (channel) onJumpToChannel(channel)
                  onClose()
                }}
                className="w-full flex gap-3 px-3 py-2 rounded hover:bg-white/5 text-left"
              >
                <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-white">
                      {author?.display_name || author?.username || 'Usuário'}
                    </span>
                    <span className="text-xs text-discord-text-muted">
                      em #{channel?.name ?? '?'} · {formatDate(message.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-discord-text truncate">{message.content}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
