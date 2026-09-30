import { describeMessageContent } from '../../lib/stickers'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import type { Message, Profile } from '../../types/database'
import { CloseIcon, PinIcon, WarningIcon } from '../ui/icons'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PinnedMessagesPanel({
  fetchPinnedMessages,
  profilesById,
  canUnpin,
  onUnpin,
  onClose,
}: {
  fetchPinnedMessages: () => Promise<Message[]>
  profilesById: Record<string, Profile>
  canUnpin: boolean
  onUnpin: (messageId: string) => void | Promise<void>
  onClose: () => void
}) {
  const [pinned, setPinned] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Antes: uma falha na busca virava uma promise rejeitada sem tratamento
  // e o spinner girava pra sempre.
  useEffect(() => {
    let cancelled = false
    fetchPinnedMessages()
      .then((list) => {
        if (!cancelled) setPinned(list)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Não foi possível carregar as mensagens fixadas.')
          setPinned([])
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  async function handleUnpin(messageId: string) {
    // Some da lista na hora — antes continuava aparecendo até fechar e
    // abrir o painel de novo.
    setPinned((prev) => prev?.filter((m) => m.id !== messageId) ?? prev)
    await onUnpin(messageId)
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex justify-end animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mensagens fixadas"
        className="w-full max-w-sm h-full bg-mv-side border-l border-[var(--color-line)] flex flex-col shadow-[-24px_0_60px_-12px_rgb(0_0_0/0.6)] animate-fade-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--color-line)] shrink-0">
          <h2 className="font-display font-semibold text-white flex items-center gap-2">
            <PinIcon className="w-5 h-5 text-mv-muted" aria-hidden />
            Mensagens fixadas
          </h2>
          <button onClick={onClose} aria-label="Fechar" title="Fechar" className="icon-btn w-9 h-9">
            <CloseIcon className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {pinned === null ? (
            <div className="space-y-2" role="status" aria-label="Carregando">
              {[70, 45, 60].map((w, i) => (
                <div key={i} className="rounded-xl border border-[var(--color-line)] p-3 animate-pulse space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-white/[0.06]" />
                    <div className="h-2.5 w-24 rounded-full bg-white/[0.06]" />
                  </div>
                  <div className="h-2.5 rounded-full bg-white/[0.05]" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center text-center gap-2 pt-12 px-4">
              <span className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <WarningIcon className="w-6 h-6 text-rose-400" aria-hidden />
              </span>
              <p className="text-sm text-rose-300">{error}</p>
            </div>
          ) : pinned.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2 pt-12 px-6">
              <span className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-[var(--color-line)] flex items-center justify-center mb-1">
                <PinIcon className="w-8 h-8 text-mv-muted" aria-hidden />
              </span>
              <p className="font-display font-semibold text-white">Nada fixado ainda</p>
              <p className="text-sm text-mv-muted">
                Clique com o botão direito numa mensagem e escolha "Fixar mensagem".
              </p>
            </div>
          ) : (
            pinned.map((message) => {
              const author = profilesById[message.author_id]
              return (
                <div key={message.id} className="bg-white/[0.03] border border-[var(--color-line)] hover:border-[var(--color-line-strong)] rounded-xl p-3 group transition-colors">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Avatar name={author?.username ?? '?'} avatarUrl={author?.avatar_url} size={24} />
                    <span className="text-sm font-semibold text-white truncate">
                      {author?.display_name || author?.username || 'Usuário'}
                    </span>
                    <span className="text-[11px] text-mv-muted shrink-0">{formatDate(message.created_at)}</span>
                    {canUnpin && (
                      <button
                        onClick={() => void handleUnpin(message.id)}
                        className="ml-auto text-xs font-medium px-2 h-7 rounded-lg text-mv-muted hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition shrink-0"
                      >
                        Desafixar
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-mv-text break-words whitespace-pre-wrap leading-relaxed">{describeMessageContent(message.content)}</p>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
