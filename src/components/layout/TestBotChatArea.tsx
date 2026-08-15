import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useTestBotChat } from '../../hooks/useTestBotChat'
import { TEST_BOT_PROFILE } from '../../lib/testBot'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const MAX_LENGTH = 2000

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function TestBotChatArea() {
  const { profile } = useAuth()
  const { messages, botTyping, sendMessage, clearChat } = useTestBotChat()
  const [value, setValue] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, botTyping])

  function handleSend() {
    const trimmed = value.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return
    sendMessage(trimmed)
    setValue('')
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <Avatar name={TEST_BOT_PROFILE.username} avatarUrl={TEST_BOT_PROFILE.avatar_url} status="online" size={24} />
        <h2 className="font-display font-semibold tracking-wide text-white">{TEST_BOT_PROFILE.display_name}</h2>
        <span className="text-[10px] uppercase bg-discord-blurple/20 text-discord-blurple px-1.5 py-0.5 rounded font-medium">
          BOT
        </span>
        <div className="flex-1" />
        <button
          onClick={clearChat}
          className="text-xs px-3 py-1 rounded bg-discord-darker text-discord-text hover:bg-discord-lighter transition-colors"
        >
          Limpar conversa
        </button>
      </header>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <Avatar name={TEST_BOT_PROFILE.username} avatarUrl={TEST_BOT_PROFILE.avatar_url} size={64} />
          <h3 className="font-display text-xl font-bold text-white mt-3 tracking-wide">
            {TEST_BOT_PROFILE.display_name}
          </h3>
          <p className="text-discord-text-muted mt-1 max-w-sm">
            Manda qualquer mensagem pra testar o chat sem precisar de outra pessoa online. Pergunta sobre "áudio",
            "tela" ou manda um "oi"!
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-4">
          {messages.map((message, i) => {
            const prev = messages[i - 1]
            const showHeader =
              !prev ||
              prev.author !== message.author ||
              new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS
            const isBot = message.author === 'bot'

            return (
              <div key={message.id} className={`group relative px-4 py-0.5 hover:bg-black/10 ${showHeader ? 'mt-3 pt-1.5' : ''}`}>
                <div className="flex gap-4">
                  {showHeader ? (
                    <div className="pt-0.5">
                      <Avatar
                        name={isBot ? TEST_BOT_PROFILE.username : profile?.username ?? '?'}
                        avatarUrl={isBot ? TEST_BOT_PROFILE.avatar_url : profile?.avatar_url}
                        size={40}
                      />
                    </div>
                  ) : (
                    <div className="w-10 shrink-0 flex items-start justify-center">
                      <span className="hidden group-hover:inline text-[10px] text-discord-text-muted pt-1">
                        {formatTime(message.created_at)}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {showHeader && (
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-white text-sm">
                          {isBot ? TEST_BOT_PROFILE.display_name : profile?.display_name || profile?.username || 'Você'}
                        </span>
                        <span className="text-xs text-discord-text-muted">{formatTime(message.created_at)}</span>
                      </div>
                    )}
                    <p className="text-sm text-discord-text whitespace-pre-wrap break-words leading-relaxed">
                      {message.content}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
          {botTyping && (
            <div className="px-4 py-1 mt-2 flex items-center gap-2 text-xs text-discord-text-muted">
              <Avatar name={TEST_BOT_PROFILE.username} avatarUrl={TEST_BOT_PROFILE.avatar_url} size={20} />
              Bot de Testes está digitando...
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="px-4 pb-6 shrink-0">
        <div className="bg-discord-lighter px-4 py-2.5 flex items-end gap-3 rounded-lg">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Testar o chat..."
            rows={1}
            maxLength={MAX_LENGTH}
            className="flex-1 bg-transparent outline-none text-discord-text placeholder:text-discord-text-muted resize-none py-1 max-h-48"
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 192)}px`
            }}
          />
          <button
            onClick={handleSend}
            disabled={value.trim().length === 0}
            className="text-discord-text-muted hover:text-discord-blurple shrink-0 pb-1 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M3.4 20.6l17.5-8.2a1 1 0 0 0 0-1.8L3.4 2.4a1 1 0 0 0-1.4 1.1L4.5 12l-2.5 8.5a1 1 0 0 0 1.4 1.1z" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  )
}
