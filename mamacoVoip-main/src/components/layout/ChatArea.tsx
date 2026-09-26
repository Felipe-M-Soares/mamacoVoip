import { useState } from 'react'
import { MessageList } from '../chat/MessageList'
import { MessageComposer } from '../chat/MessageComposer'
import { SearchModal } from '../modals/SearchModal'
import { PinnedMessagesPanel } from '../chat/PinnedMessagesPanel'
import { useMessages } from '../../hooks/useMessages'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useChannels } from '../../hooks/useChannels'
import { useAuth } from '../../hooks/useAuth'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { useServerEmojis } from '../../hooks/useServerEmojis'
import { useChannelThreads } from '../../hooks/useChannelThreads'
import { ThreadPanel } from './ThreadPanel'
import { useRoles } from '../../hooks/useRoles'
import { ForwardMessageModal } from '../modals/ForwardMessageModal'
import { ReportModal } from '../modals/ReportModal'
import type { Channel, Message, Server, Profile, Thread } from '../../types/database'

export function ChatArea({
  channel,
  server,
  onViewProfile,
  onJumpToChannel,
  onToggleMembers,
}: {
  channel: Channel
  server: Server
  onViewProfile: (profile: Profile) => void
  onJumpToChannel: (channel: Channel, serverId?: string) => void
  onToggleMembers?: () => void
}) {
  const { user } = useAuth()
  const { messages, loading, attachments, reactions, sendMessage, editMessage, deleteMessage, toggleReaction, pinMessage, unpinMessage, fetchPinnedMessages } =
    useMessages(channel.id, server.id)
  const { members } = useServerMembers(server.id)
  const { channels } = useChannels()
  const { typingUserIds, notifyTyping } = useTypingIndicator(channel.id, user?.id)
  const { emojis } = useServerEmojis(server.id)
  const { roles, rolesForUser } = useRoles(server.id)
  const { threadsByMessageId, replyCounts, createThread } = useChannelThreads(channel.id)
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null)
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null)
  const [revealedSpoilerChannelId, setRevealedSpoilerChannelId] = useState<string | null>(null)
  const isSpoilerHidden = channel.is_spoiler && revealedSpoilerChannelId !== channel.id

  function handleJumpToMessage(messageId: string) {
    const el = document.getElementById(`message-${messageId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMessageId(messageId)
    setTimeout(() => setHighlightedMessageId((current) => (current === messageId ? null : current)), 2000)
  }

  async function handleCreateThread(messageId: string) {
    const name = prompt('Nome da thread:')
    if (!name) return
    const { thread, error } = await createThread(messageId, server.id, name)
    if (thread) setActiveThread(thread)
    if (error) alert(error)
  }
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showPinned, setShowPinned] = useState(false)

  const profilesById = Object.fromEntries(members.map((m) => [m.user_id, m.profile]))
  const memberProfiles = members.map((m) => m.profile)
  const isServerOwner = server.owner_id === user?.id
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())

  function toggleSelectMessage(messageId: string) {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  async function handleBulkDelete() {
    if (selectedMessageIds.size === 0) return
    if (!confirm(`Excluir ${selectedMessageIds.size} mensagem(ns)? Essa ação não pode ser desfeita.`)) return
    await Promise.all([...selectedMessageIds].map((id) => deleteMessage(id)))
    setSelectedMessageIds(new Set())
    setSelectionMode(false)
  }

  const typingNames = typingUserIds
    .map((id) => profilesById[id]?.display_name || profilesById[id]?.username)
    .filter((name): name is string => Boolean(name))

  // Antes essa função não devolvia nada pra quem chamou (o `await` sem
  // `return` faz o handleSend sempre resolver como undefined, mesmo
  // quando sendMessage() retornava um erro de verdade). O MessageComposer
  // depende exatamente desse retorno pra decidir se mostra o erro ou
  // limpa a caixa de texto — sem o `return` aqui, ele sempre tratava como
  // sucesso: limpava o que foi digitado e nunca mostrava nenhum erro,
  // mesmo quando o envio falhava silenciosamente. É esse o motivo de
  // "escrevo e mando e não aparece nada".
  async function handleSend(content: string, files: File[]) {
    if (content.length === 0 && files.length === 0) return
    const result = await sendMessage(content, replyingTo?.id ?? null, files)
    setReplyingTo(null)
    return result
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-discord-channels">
      <header className="h-12 px-4 flex items-center gap-2 border-b border-black/20 shadow-sm shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-discord-text-muted">
          <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
        </svg>
        <h2 className="font-display font-semibold tracking-wide text-white shrink-0">{channel.name}</h2>
        {channel.slowmode_seconds > 0 && (
          <span
            title={`Modo lento: ${channel.slowmode_seconds}s entre mensagens`}
            className="flex items-center gap-1 text-xs text-yellow-400 shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.3-.7 1.3-4.8-2.8V7h1.5z" />
            </svg>
          </span>
        )}
        {channel.topic && (
          <>
            <span className="text-discord-text-muted shrink-0">|</span>
            <p className="text-sm text-discord-text-muted truncate flex-1">{channel.topic}</p>
          </>
        )}
        {!channel.topic && <div className="flex-1" />}
        {isServerOwner && (
          <button
            onClick={() => {
              setSelectionMode((v) => !v)
              setSelectedMessageIds(new Set())
            }}
            title="Selecionar mensagens"
            className={`transition-colors ${selectionMode ? 'text-discord-blurple' : 'text-discord-text-muted hover:text-white'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4z" />
            </svg>
          </button>
        )}
        <button
          onClick={() => setShowPinned(true)}
          title="Mensagens fixadas"
          className="text-discord-text-muted hover:text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
          </svg>
        </button>
        <button
          onClick={() => setShowSearch(true)}
          title="Pesquisar mensagens"
          className="text-discord-text-muted hover:text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M10 4a6 6 0 1 0 3.76 10.66l5.29 5.29a1 1 0 0 0 1.41-1.41l-5.29-5.29A6 6 0 0 0 10 4zm-4 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
          </svg>
        </button>
        {onToggleMembers && (
          <button
            onClick={onToggleMembers}
            title="Membros"
            className="lg:hidden text-discord-text-muted hover:text-white transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
          </button>
        )}
      </header>

      {isSpoilerHidden ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
          <div className="absolute inset-0 backdrop-blur-2xl bg-discord-channels/70" />
          <div className="relative z-10 flex flex-col items-center gap-3 text-center px-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-yellow-400">
              <path d="M12 2a5 5 0 0 0-5 5v3H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z" />
            </svg>
            <p className="text-white font-medium">Este canal tem conteúdo marcado como spoiler</p>
            <button
              onClick={() => setRevealedSpoilerChannelId(channel.id)}
              className="px-4 py-2 rounded btn-primary text-sm"
            >
              Revelar conteúdo
            </button>
          </div>
        </div>
      ) : (
        <>

      <MessageList
        channelName={channel.name}
        messages={messages}
        loading={loading}
        attachments={attachments}
        reactions={reactions}
        profilesById={profilesById}
        currentUserId={user?.id}
        isServerOwner={isServerOwner}
        members={memberProfiles}
        emojis={emojis}
        roles={roles}
        rolesForUser={rolesForUser}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onReply={setReplyingTo}
        onToggleReaction={toggleReaction}
        onViewProfile={onViewProfile}
        onPin={(id) => pinMessage(id)}
        onUnpin={(id) => unpinMessage(id)}
        threadsByMessageId={threadsByMessageId}
        replyCounts={replyCounts}
        onCreateThread={handleCreateThread}
        onOpenThread={setActiveThread}
        onJumpToMessage={handleJumpToMessage}
        highlightedMessageId={highlightedMessageId}
        onForward={setForwardingMessageId}
        selectionMode={selectionMode}
        selectedMessageIds={selectedMessageIds}
        onToggleSelect={toggleSelectMessage}
        onReport={setReportingMessageId}
      />

      {typingNames.length > 0 && (
        <div className="px-4 pb-1 flex items-center gap-2 text-xs text-discord-text-muted shrink-0">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 rounded-full bg-discord-text-muted animate-bounce" />
          </span>
          <span className="truncate">
            {typingNames.length === 1
              ? `${typingNames[0]} está digitando...`
              : typingNames.length === 2
                ? `${typingNames[0]} e ${typingNames[1]} estão digitando...`
                : `${typingNames.length} pessoas estão digitando...`}
          </span>
        </div>
      )}

      <MessageComposer
        channelName={channel.name}
        members={memberProfiles}
        emojis={emojis}
        roles={roles}
        draftKey={channel.id}
        replyingTo={replyingTo}
        replyingToAuthor={replyingTo ? profilesById[replyingTo.author_id] : undefined}
        onCancelReply={() => setReplyingTo(null)}
        onSend={handleSend}
        onTyping={notifyTyping}
      />

      {showSearch && (
        <SearchModal
          serverId={server.id}
          channels={channels}
          onClose={() => setShowSearch(false)}
          onJumpToChannel={onJumpToChannel}
        />
      )}

      {showPinned && (
        <PinnedMessagesPanel
          fetchPinnedMessages={fetchPinnedMessages}
          profilesById={profilesById}
          canUnpin={isServerOwner}
          onUnpin={(id) => unpinMessage(id)}
          onClose={() => setShowPinned(false)}
        />
      )}

      {activeThread && (
        <ThreadPanel
          thread={activeThread}
          serverId={server.id}
          isServerOwner={isServerOwner}
          memberProfiles={memberProfiles}
          profilesById={profilesById}
          emojis={emojis}
          onViewProfile={onViewProfile}
          onClose={() => setActiveThread(null)}
        />
      )}

      {reportingMessageId &&
        (() => {
          const msg = messages.find((m) => m.id === reportingMessageId)
          if (!msg) return null
          return (
            <ReportModal
              targetType="message"
              targetLabel={`mensagem em #${channel.name}`}
              messageId={msg.id}
              serverId={server.id}
              onClose={() => setReportingMessageId(null)}
            />
          )
        })()}

      {forwardingMessageId &&
        (() => {
          const msg = messages.find((m) => m.id === forwardingMessageId)
          if (!msg) return null
          return (
            <ForwardMessageModal
              message={msg}
              author={profilesById[msg.author_id]}
              channels={channels.filter((c) => c.server_id === server.id)}
              serverId={server.id}
              onClose={() => setForwardingMessageId(null)}
            />
          )
        })()}
      {selectionMode && selectedMessageIds.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-discord-dark border border-red-900/40 rounded-full shadow-2xl px-4 py-2 flex items-center gap-3">
          <span className="text-sm text-discord-text">{selectedMessageIds.size} selecionada(s)</span>
          <button onClick={handleBulkDelete} className="text-sm px-3 py-1 rounded-full bg-red-600 text-white hover:brightness-110">
            Excluir
          </button>
          <button
            onClick={() => {
              setSelectionMode(false)
              setSelectedMessageIds(new Set())
            }}
            className="text-sm text-discord-text-muted hover:text-white"
          >
            Cancelar
          </button>
        </div>
      )}
      </>
      )}
    </section>
  )
}
