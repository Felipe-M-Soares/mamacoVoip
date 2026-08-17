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

  return (
    <div className="fixed inset-0 z-[350] bg-black/60 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-discord-dark rounded-2xl shadow-2xl border border-discord-blurple/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted shrink-0">
            <path d="M10 4a6 6 0 1 0 3.76 10.66l5.29 5.29a1 1 0 0 0 1.41-1.41l-5.29-5.29A6 6 0 0 0 10 4zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pular pra um servidor ou conversa..."
            className="flex-1 bg-transparent outline-none text-discord-text placeholder:text-discord-text-muted"
          />
          <kbd className="text-[10px] text-discord-text-muted bg-discord-darker px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="text-sm text-discord-text-muted text-center py-6">Nada encontrado.</p>
          ) : (
            results.map((item, i) => (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => selectItem(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-discord-lighter' : ''
                }`}
              >
                {item.kind === 'server' ? (
                  item.iconUrl ? (
                    <img src={item.iconUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-discord-blurple flex items-center justify-center text-white text-xs font-semibold shrink-0">
                      {item.label.slice(0, 2).toUpperCase()}
                    </div>
                  )
                ) : item.kind === 'channel' ? (
                  <div className="w-8 h-8 rounded-full bg-discord-darker flex items-center justify-center text-discord-text-muted shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      {item.channel.type === 'voice' ? (
                        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
                      ) : (
                        <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
                      )}
                    </svg>
                  </div>
                ) : (
                  <Avatar name={item.username} avatarUrl={item.avatarUrl} size={32} />
                )}
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{item.label}</p>
                  <p className="text-[10px] text-discord-text-muted">
                    {item.kind === 'server' ? 'Servidor' : item.kind === 'channel' ? 'Canal' : 'Conversa direta'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
