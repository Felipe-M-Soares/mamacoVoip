import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { supabase } from '../../lib/supabase'
import { useServerMembers } from '../../hooks/useServerMembers'
import type { Channel, Message } from '../../types/database'

interface ParsedQuery {
  freeText: string
  fromUsername: string | null
  inChannelName: string | null
  hasFile: boolean
  before: Date | null
  after: Date | null
}

function parseSearchQuery(raw: string): ParsedQuery {
  let text = raw
  let fromUsername: string | null = null
  let inChannelName: string | null = null
  let hasFile = false
  let before: Date | null = null
  let after: Date | null = null

  text = text.replace(/\bde:(\S+)/gi, (_m, u: string) => {
    fromUsername = u.replace('@', '')
    return ''
  })
  text = text.replace(/\bem:(\S+)/gi, (_m, c: string) => {
    inChannelName = c.replace('#', '')
    return ''
  })
  text = text.replace(/\bcom:arquivo\b/gi, () => {
    hasFile = true
    return ''
  })
  text = text.replace(/\bantes:(\d{2}\/\d{2}\/\d{4})/gi, (_m, d: string) => {
    const [dd, mm, yyyy] = d.split('/')
    before = new Date(`${yyyy}-${mm}-${dd}T23:59:59`)
    return ''
  })
  text = text.replace(/\bdepois:(\d{2}\/\d{2}\/\d{4})/gi, (_m, d: string) => {
    const [dd, mm, yyyy] = d.split('/')
    after = new Date(`${yyyy}-${mm}-${dd}T00:00:00`)
    return ''
  })

  return { freeText: text.replace(/\s+/g, ' ').trim(), fromUsername, inChannelName, hasFile, before, after }
}

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

  const [filterError, setFilterError] = useState<string | null>(null)

  async function handleSearch() {
    const parsed = parseSearchQuery(query)
    const hasAnyFilter = parsed.fromUsername || parsed.inChannelName || parsed.hasFile || parsed.before || parsed.after
    if (parsed.freeText.length < 2 && !hasAnyFilter) return

    setFilterError(null)
    setLoading(true)
    setSearched(true)

    let dbQuery = supabase.from('messages').select('*').eq('server_id', serverId)

    if (parsed.freeText.length >= 1) dbQuery = dbQuery.ilike('content', `%${parsed.freeText}%`)

    if (parsed.fromUsername) {
      const author = members.find((m) => m.profile.username.toLowerCase() === parsed.fromUsername!.toLowerCase())
      if (!author) {
        setResults([])
        setLoading(false)
        setFilterError(`Ninguém com o nome de usuário "${parsed.fromUsername}" foi encontrado neste servidor.`)
        return
      }
      dbQuery = dbQuery.eq('author_id', author.user_id)
    }

    if (parsed.inChannelName) {
      const channel = channels.find((c) => c.name.toLowerCase() === parsed.inChannelName!.toLowerCase())
      if (!channel) {
        setResults([])
        setLoading(false)
        setFilterError(`Nenhum canal chamado "${parsed.inChannelName}" foi encontrado.`)
        return
      }
      dbQuery = dbQuery.eq('channel_id', channel.id)
    }

    if (parsed.before) dbQuery = dbQuery.lt('created_at', parsed.before.toISOString())
    if (parsed.after) dbQuery = dbQuery.gt('created_at', parsed.after.toISOString())

    const { data } = await dbQuery.order('created_at', { ascending: false }).limit(50)
    let list = data ?? []

    if (parsed.hasFile && list.length > 0) {
      const { data: attRows } = await supabase
        .from('message_attachments')
        .select('message_id')
        .in(
          'message_id',
          list.map((m) => m.id)
        )
      const idsWithFile = new Set((attRows ?? []).map((r) => r.message_id))
      list = list.filter((m) => idsWithFile.has(m.id))
    }

    setResults(list)
    setLoading(false)
  }

  return (
    <Modal title="Pesquisar mensagens" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex gap-2 mb-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Buscar... (ex: de:fulano em:geral com:arquivo)"
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
      <p className="text-[10px] text-discord-text-muted mb-4">
        Filtros: <code>de:usuário</code> · <code>em:canal</code> · <code>com:arquivo</code> ·{' '}
        <code>antes:DD/MM/AAAA</code> · <code>depois:DD/MM/AAAA</code>
      </p>

      {filterError && <p className="text-sm text-red-400 mb-3">{filterError}</p>}

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
