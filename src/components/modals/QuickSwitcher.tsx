import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { supabase } from '../../lib/supabase'
import type { Server, Channel } from '../../types/database'

export interface QuickSwitcherConversation {
  id: string
  otherProfile: { username: string; display_name: string | null; avatar_url: string | null }
}

export function QuickSwitcher({
  servers,
  conversations,
  activeServerId,
  onSelectServer,
  onSelectConversation,
  onSelectChannel,
  onClose,
}: {
  servers: Server[]
  conversations: QuickSwitcherConversation[]
  activeServerId: string | null
  onSelectServer: (server: Server) => void
  onSelectConversation: (conversationId: string) => void
  onSelectChannel: (channel: Channel) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeServerChannels, setActiveServerChannels] = useState<Channel[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!activeServerId) {
      setActiveServerChannels([])
      return
    }
    supabase
      .from('channels')
      .select('*')
      .eq('server_id', activeServerId)
      .then(({ data }) => setActiveServerChannels(data ?? []))
  }, [activeServerId])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchedServers = servers
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((s) => ({ kind: 'server' as const, id: s.id, label: s.name, iconUrl: s.icon_url, server: s }))
    const matchedChannels = activeServerChannels
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((c) => ({ kind: 'channel' as const, id: c.id, label: c.name, channel: c }))
    const matchedConversations = conversations
      .filter((c) => {
        if (!q) return true
        const name = c.otherProfile.display_name || c.otherProfile.username
        return name.toLowerCase().includes(q) || c.otherProfile.username.toLowerCase().includes(q)
      })
      .slice(0, 6)
      .map((c) => ({
        kind: 'conversation' as const,
        id: c.id,
        label: c.otherProfile.display_name || c.otherProfile.username,
        avatarUrl: c.otherProfile.avatar_url,
        username: c.otherProfile.username,
      }))
    return [...matchedChannels, ...matchedServers, ...matchedConversations]
  }, [query, servers, conversations, activeServerChannels])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Mantém o item ativo visível ao navegar com as setas.
  useEffect(() => {
    const item = results[selectedIndex]
    if (item) document.getElementById(`qs-${item.kind}-${item.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, results])

  function selectItem(item: (typeof results)[number]) {
    if (item.kind === 'server') onSelectServer(item.server)
    else if (item.kind === 'channel') onSelectChannel(item.channel)
    else onSelectConversation(item.id)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && results[selectedIndex]) {
      selectItem(results[selectedIndex])
    }
  }

  const KIND_LABEL = { channel: 'Canais', server: 'Servidores', conversation: 'Conversas diretas' } as const

  // Portal no <body>: se algum ancestral tiver transform/filter, um
  // "fixed" dentro dele passa a ser relativo a esse ancestral (e o
  // overlay aparecia preso dentro da barra lateral).
  return createPortal(
    <div
      className="fixed inset-0 z-[350] bg-black/70 animate-fade-in flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Seletor rápido"
        className="w-full max-w-xl surface-elevated rounded-2xl overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 h-16 border-b border-[var(--color-line)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5 text-mv-muted shrink-0" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pular pra um servidor ou conversa..."
            aria-label="Pular pra um servidor, canal ou conversa"
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-switcher-list"
            aria-activedescendant={results[selectedIndex] ? `qs-${results[selectedIndex].kind}-${results[selectedIndex].id}` : undefined}
            // O CSS global desenha um anel de foco em todo input; aqui o campo
            // é "sem moldura" (a própria paleta é a moldura), então some com ele.
            style={{ boxShadow: 'none' }}
            className="flex-1 min-w-0 bg-transparent outline-none text-[17px] text-white placeholder:text-mv-muted"
          />
          <kbd className="shrink-0 inline-flex items-center h-6 px-2 rounded-md bg-mv-canvas border border-[var(--color-line-strong)] border-b-2 font-mono text-[11px] text-mv-muted">
            ESC
          </kbd>
        </div>

        <div id="quick-switcher-list" role="listbox" aria-label="Resultados" className="max-h-[min(420px,55vh)] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="flex flex-col items-center text-center py-10 px-4">
              <span className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-[var(--color-line)] flex items-center justify-center text-mv-muted mb-3">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-6 h-6" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m20 20-4.2-4.2M8.5 11h5" />
                </svg>
              </span>
              <p className="text-[14px] font-medium text-white">Nada encontrado</p>
              <p className="text-[12.5px] text-mv-muted mt-0.5">Tente outro nome de servidor, canal ou pessoa.</p>
            </div>
          ) : (
            results.map((item, i) => {
              const active = i === selectedIndex
              const showHeader = i === 0 || results[i - 1].kind !== item.kind
              return (
                <div key={`${item.kind}-${item.id}`}>
                  {showHeader && (
                    <p className={`px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted ${i === 0 ? 'pt-1' : 'pt-3'}`}>
                      {KIND_LABEL[item.kind]}
                    </p>
                  )}
                  <button
                    id={`qs-${item.kind}-${item.id}`}
                    role="option"
                    aria-selected={active}
                    onClick={() => selectItem(item)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-[10px] text-left transition-colors ${
                      active ? 'bg-white/[0.07] shadow-[inset_0_0_0_1px_var(--color-line)]' : ''
                    }`}
                  >
                    {item.kind === 'server' ? (
                      item.iconUrl ? (
                        <img src={item.iconUrl} alt="" className="w-8 h-8 rounded-[10px] object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-[10px] bg-brand-gradient flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
                          {item.label.slice(0, 2).toUpperCase()}
                        </div>
                      )
                    ) : item.kind === 'channel' ? (
                      <div className="w-8 h-8 rounded-[10px] bg-white/[0.05] border border-[var(--color-line)] flex items-center justify-center text-mv-muted shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
                          {item.channel.type === 'voice' ? (
                            <path d="M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                          ) : (
                            <path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" />
                          )}
                        </svg>
                      </div>
                    ) : (
                      <Avatar name={item.username} avatarUrl={item.avatarUrl} size={32} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14px] truncate ${active ? 'text-white' : 'text-mv-text'}`}>{item.label}</p>
                      <p className="text-[11.5px] text-mv-muted">
                        {item.kind === 'server' ? 'Servidor' : item.kind === 'channel' ? 'Canal' : 'Conversa direta'}
                      </p>
                    </div>
                    {active && (
                      <kbd aria-hidden="true" className="shrink-0 inline-flex items-center h-6 px-1.5 rounded-md bg-mv-canvas border border-[var(--color-line-strong)] font-mono text-[11px] text-mv-muted">
                        ↵
                      </kbd>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 h-10 border-t border-[var(--color-line)] bg-black/[0.12] text-[11.5px] text-mv-muted">
          <span className="flex items-center gap-1.5">
            <KbdHint>↑</KbdHint>
            <KbdHint>↓</KbdHint>
            navegar
          </span>
          <span className="flex items-center gap-1.5">
            <KbdHint>↵</KbdHint>
            abrir
          </span>
          <span className="flex items-center gap-1.5">
            <KbdHint>Esc</KbdHint>
            fechar
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

function KbdHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-mv-canvas border border-[var(--color-line-strong)] font-mono text-[10.5px] text-mv-muted">
      {children}
    </kbd>
  )
}
