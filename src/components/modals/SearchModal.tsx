import { describeMessageContent } from '../../lib/stickers'
import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { Avatar } from '../ui/Avatar'
import { Toggle } from '../ui/Toggle'
import { supabase } from '../../lib/supabase'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useServers } from '../../hooks/useServers'
import { useAdultContent } from '../../hooks/useAdultContent'
import type { Channel, Message, Profile, Server } from '../../types/database'
import { SearchIcon } from '../ui/icons'

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
  const adultContent = useAdultContent()
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
  const inputRef = useRef<HTMLInputElement>(null)

  // Atalhos de filtro clicáveis — só acrescentam o prefixo no campo.
  const FILTER_HINTS = ['de:', 'em:', 'com:arquivo', 'antes:', 'depois:']
  function addFilter(token: string) {
    setQuery((q) => (q.trim() ? `${q.trim()} ${token}` : token))
    inputRef.current?.focus()
  }

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

    // Mensagens de canais +18 só aparecem na busca pra quem confirmou a
    // idade e deixou "Mostrar conteúdo +18" ligado — senão a busca
    // furaria o portão de idade do canal.
    if (!(adultContent.verified && adultContent.showAdult)) {
      const nsfwChannelIds = new Set(searchableChannels.filter((c) => c.is_nsfw).map((c) => c.id))
      if (nsfwChannelIds.size > 0) list = list.filter((m) => !nsfwChannelIds.has(m.channel_id))
    }

    setResults(list)
    setLoading(false)
  }

  return (
    <Modal title="Pesquisar mensagens" onClose={onClose} maxWidth="max-w-xl" headerless>
      <div className="flex items-center gap-3 pl-5 pr-14 h-16 border-b border-[var(--color-line)]">
        <SearchIcon className="w-5 h-5 text-mv-muted shrink-0" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Buscar mensagens..."
          aria-label="Buscar mensagens (ex: de:fulano em:geral com:arquivo)"
          autoFocus
          // O CSS global desenha um anel de foco em todo input; aqui o campo
          // é "sem moldura" (a própria paleta é a moldura), então some com ele.
          style={{ boxShadow: 'none' }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[17px] text-white placeholder:text-mv-muted"
        />
        <button onClick={handleSearch} className="btn-primary h-8 px-3.5 text-[13px] shrink-0">
          Buscar
        </button>
      </div>

      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-1.5 border-b border-[var(--color-line)]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mr-1">Filtros</span>
        {FILTER_HINTS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => addFilter(f)}
            className="chip font-mono !font-medium hover:!text-white hover:!border-[var(--color-line-strong)] hover:!bg-white/[0.08] transition-colors"
          >
            {f}
          </button>
        ))}
        {servers.length > 1 && (
          <span className="ml-auto flex items-center gap-2 text-[12px] text-mv-muted select-none">
            <Toggle
              size="sm"
              id="search-cross-server"
              checked={crossServer}
              onChange={setCrossServer}
            />
            <label htmlFor="search-cross-server" className="cursor-pointer">
              Todos os meus servidores ({servers.length})
            </label>
          </span>
        )}
      </div>

      <div className="p-2 min-h-[120px]">
        {filterError && <p className="text-sm text-rose-400 px-2.5 py-2">{filterError}</p>}

        {loading ? (
          <div className="space-y-1 p-1" aria-busy="true" aria-label="Buscando">
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="flex gap-3 px-2.5 py-2">
                <div className="w-8 h-8 rounded-full animate-pulse bg-white/[0.05] shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-2.5 w-40 rounded animate-pulse bg-white/[0.05]" />
                  <div className="h-2.5 w-full rounded animate-pulse bg-white/[0.05]" />
                </div>
              </div>
            ))}
          </div>
        ) : searched && results.length === 0 ? (
          !filterError && (
            <div className="flex flex-col items-center text-center py-8">
              <span className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-[var(--color-line)] flex items-center justify-center text-mv-muted mb-3">
                <SearchIcon className="w-6 h-6" strokeWidth={1.8} aria-hidden />
              </span>
              <p className="text-[14px] font-medium text-white">Nenhuma mensagem encontrada</p>
              <p className="text-[12.5px] text-mv-muted mt-0.5">Tente outras palavras ou tire algum filtro.</p>
            </div>
          )
        ) : !searched ? (
          <div className="px-3 py-4 space-y-2 text-[12.5px] text-mv-muted">
            <p>
              Combine texto com filtros, por exemplo{' '}
              <code className="font-mono text-mv-text bg-mv-canvas px-1.5 py-0.5 rounded">de:ana em:geral clip</code>
            </p>
            <p>
              Datas no formato <code className="font-mono text-mv-text">DD/MM/AAAA</code> em{' '}
              <code className="font-mono text-mv-text">antes:</code> e <code className="font-mono text-mv-text">depois:</code>.
              Aperte <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-mv-canvas border border-[var(--color-line-strong)]">Enter</kbd> pra buscar.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 max-h-[min(420px,55vh)] overflow-y-auto">
            <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">
              {results.length} resultado{results.length !== 1 ? 's' : ''}
            </p>
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
                  className="group w-full flex gap-3 px-2.5 py-2 rounded-[10px] hover:bg-white/[0.06] focus-visible:bg-white/[0.06] text-left transition-colors"
                >
                  <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[14px] font-medium text-white shrink-0">
                        {author?.display_name || author?.username || 'Usuário'}
                      </span>
                      <span className="text-[11.5px] text-mv-muted truncate">
                        em #{channel?.name ?? '?'}
                        {server ? ` · ${server.name}` : ''} · {formatDate(message.created_at)}
                      </span>
                    </div>
                    <p className="text-[13.5px] text-mv-text truncate">{describeMessageContent(message.content)}</p>
                  </div>
                  <span aria-hidden="true" className="self-center text-[11px] text-mv-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    Ir →
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
