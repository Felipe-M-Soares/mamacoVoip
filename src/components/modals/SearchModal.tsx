import { useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { supabase } from '../../lib/supabase'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useServers } from '../../hooks/useServers'
import type { Channel, Message, Profile, Server } from '../../types/database'

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
  // O segundo parâmetro (serverId de destino) só é passado quando o
  // resultado clicado é de OUTRO servidor (busca em todos os
  // servidores) — quem lida com isso (MainLayout) troca de servidor
  // antes de abrir o canal. Pra um resultado do servidor atual, chega
  // sem esse segundo parâmetro, igual sempre funcionou.
  onJumpToChannel: (channel: Channel, serverId?: string) => void
}) {
  const { members } = useServerMembers(serverId)
  const { servers } = useServers()
  const [query, setQuery] = useState('')
  const [crossServer, setCrossServer] = useState(false)
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // Em modo "todos os servidores", esses dois mapas são reconstruídos
  // a cada busca (não dá pra confiar só nos dados do servidor atual,
  // já que os resultados podem vir de qualquer servidor que o usuário
  // participa).
  const [extraProfilesById, setExtraProfilesById] = useState<Record<string, Profile>>({})
  const [extraChannelsById, setExtraChannelsById] = useState<Record<string, Channel>>({})
  const [serverById, setServerById] = useState<Record<string, Server>>({})

  const profileById = { ...extraProfilesById, ...Object.fromEntries(members.map((m) => [m.user_id, m.profile])) }
  const channelById = { ...extraChannelsById, ...Object.fromEntries(channels.map((c) => [c.id, c])) }

  const [filterError, setFilterError] = useState<string | null>(null)

  async function handleSearch() {
    const parsed = parseSearchQuery(query)
    const hasAnyFilter = parsed.fromUsername || parsed.inChannelName || parsed.hasFile || parsed.before || parsed.after
    if (parsed.freeText.length < 2 && !hasAnyFilter) return

    setFilterError(null)
    setLoading(true)
    setSearched(true)

    const serverIds = crossServer ? servers.map((s) => s.id) : [serverId]

    // Em modo cross-server, os canais/perfis do servidor atual (vindos
    // via props/hook) não bastam — busca canais de TODOS os servidores
    // do usuário antes de rodar a busca em si, pra poder resolver nome
    // de canal/autor nos resultados e aplicar o filtro em:canal.
    let searchableChannels = channels
    if (crossServer) {
      const { data: allChannels } = await supabase.from('channels').select('*').in('server_id', serverIds)
      searchableChannels = allChannels ?? []
      setExtraChannelsById(Object.fromEntries(searchableChannels.map((c) => [c.id, c])))
      setServerById(Object.fromEntries(servers.map((s) => [s.id, s])))
    }

    let dbQuery = supabase.from('messages').select('*').in('server_id', serverIds)

    if (parsed.freeText.length >= 1) dbQuery = dbQuery.ilike('content', `%${parsed.freeText}%`)

    if (parsed.fromUsername) {
      // Em modo cross-server não dá pra resolver "de:usuário" pela
      // lista de membros de UM servidor só — filtra pelo texto
      // diretamente na tabela profiles (username é único no app todo).
      const { data: authorRows } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', parsed.fromUsername)
        .limit(1)
      const authorId = crossServer
        ? authorRows?.[0]?.id
        : members.find((m) => m.profile.username.toLowerCase() === parsed.fromUsername!.toLowerCase())?.user_id
      if (!authorId) {
        setResults([])
        setLoading(false)
        setFilterError(`Ninguém com o nome de usuário "${parsed.fromUsername}" foi encontrado.`)
        return
      }
      dbQuery = dbQuery.eq('author_id', authorId)
    }

    if (parsed.inChannelName) {
      // Nomes de canal podem se repetir entre servidores diferentes —
      // em modo cross-server isso casa com QUALQUER canal com esse
      // nome, não só um específico.
      const matches = searchableChannels.filter((c) => c.name.toLowerCase() === parsed.inChannelName!.toLowerCase())
      if (matches.length === 0) {
        setResults([])
        setLoading(false)
        setFilterError(`Nenhum canal chamado "${parsed.inChannelName}" foi encontrado.`)
        return
      }
      dbQuery = crossServer
        ? dbQuery.in('channel_id', matches.map((c) => c.id))
        : dbQuery.eq('channel_id', matches[0].id)
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

    if (crossServer && list.length > 0) {
      const authorIds = [...new Set(list.map((m) => m.author_id))]
      const { data: profileRows } = await supabase.from('profiles').select('*').in('id', authorIds)
      setExtraProfilesById(Object.fromEntries((profileRows ?? []).map((p) => [p.id, p])))
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

      {servers.length > 1 && (
        <label className="flex items-center gap-2 mb-2 text-xs text-discord-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={crossServer}
            onChange={(e) => setCrossServer(e.target.checked)}
            className="accent-discord-blurple"
          />
          Buscar em todos os meus servidores ({servers.length})
        </label>
      )}

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
            const fromOtherServer = message.server_id !== serverId
            const server = fromOtherServer ? serverById[message.server_id] : undefined
            return (
              <button
                key={message.id}
                onClick={() => {
                  if (channel) onJumpToChannel(channel, fromOtherServer ? message.server_id : undefined)
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
                      em #{channel?.name ?? '?'}
                      {server ? ` · ${server.name}` : ''} · {formatDate(message.created_at)}
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
