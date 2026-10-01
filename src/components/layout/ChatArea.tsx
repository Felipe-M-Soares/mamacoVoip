import { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { lazyComponent } from '../modals/lazyModal'
import { MessageList } from '../chat/MessageList'
import { MessageComposer } from '../chat/MessageComposer'
import { useMessages } from '../../hooks/useMessages'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useChannels } from '../../hooks/useChannels'
import { useAuth } from '../../hooks/useAuth'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { useServerEmojis } from '../../hooks/useServerEmojis'
import { useChannelThreads } from '../../hooks/useChannelThreads'
import { useRoles } from '../../hooks/useRoles'
import { useAdultContent } from '../../hooks/useAdultContent'
import { shouldGateAdultChannel } from '../../lib/adultContent'
import type { Channel, Message, Server, Profile, Thread } from '../../types/database'
import { ClockIcon, LockIcon, MembersIcon, PinIcon, SearchIcon, TextChannelIcon } from '../ui/icons'

// Painéis/modais que só aparecem sob demanda — carregados só quando abertos,
// fora do pacote inicial do app.
const SearchModal = lazyComponent(() => import('../modals/SearchModal').then((m) => m.SearchModal))
const PinnedMessagesPanel = lazyComponent(() => import('../chat/PinnedMessagesPanel').then((m) => m.PinnedMessagesPanel))
const ThreadPanel = lazyComponent(() => import('./ThreadPanel').then((m) => m.ThreadPanel))
const ForwardMessageModal = lazyComponent(() => import('../modals/ForwardMessageModal').then((m) => m.ForwardMessageModal))
const ReportModal = lazyComponent(() => import('../modals/ReportModal').then((m) => m.ReportModal))

export function ChatArea({
  channel,
  server,
  onViewProfile,
  onJumpToChannel,
  onToggleMembers,
  membersOpen = false,
}: {
  channel: Channel
  server: Server
  onViewProfile: (profile: Profile) => void
  onJumpToChannel: (channel: Channel, serverId?: string) => void
  onToggleMembers?: () => void
  membersOpen?: boolean
}) {
  const { user } = useAuth()
  const {
    messages,
    loading,
    loadingOlder,
    hasMore,
    loadOlder,
    loadError,
    refresh,
    attachments,
    reactions,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    pinMessage,
    unpinMessage,
    fetchPinnedMessages,
  } = useMessages(channel.id, server.id)
  const { members } = useServerMembers(server.id)
  const { channels } = useChannels()
  const { typingUserIds, notifyTyping, stopTyping } = useTypingIndicator(channel.id, user?.id)
  const { emojis } = useServerEmojis(server.id)
  const { roles, rolesForUser } = useRoles(server.id)
  const { threadsByMessageId, replyCounts, createThread } = useChannelThreads(channel.id)
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null)
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null)
  const [revealedSpoilerChannelId, setRevealedSpoilerChannelId] = useState<string | null>(null)
  // Canal +18 (migration 015): portão de idade por cima do conteúdo, no
  // mesmo padrão visual do aviso de spoiler. Confirmar grava no perfil
  // (e localmente); com "Mostrar conteúdo +18" desligado nas
  // Configurações, o portão volta a cada visita.
  const adultContent = useAdultContent()
  const [revealedAdultChannelId, setRevealedAdultChannelId] = useState<string | null>(null)
  const isAdultGated = shouldGateAdultChannel({
    isNsfw: !!channel.is_nsfw,
    verified: adultContent.verified,
    showAdult: adultContent.showAdult,
    revealedThisVisit: revealedAdultChannelId === channel.id,
  })
  const isSpoilerHidden = !isAdultGated && channel.is_spoiler && revealedSpoilerChannelId !== channel.id
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleJumpToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`message-${messageId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMessageId(messageId)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId((current) => (current === messageId ? null : current)), 2000)
  }, [])

  const handleCreateThread = useCallback(
    async (messageId: string) => {
      const name = prompt('Nome da thread:')
      if (!name) return
      const { thread, error } = await createThread(messageId, server.id, name)
      if (thread) setActiveThread(thread)
      if (error) alert(error)
    },
    // createThread do hook é recriado a cada render; o que importa é o canal/servidor
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel.id, server.id]
  )
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showPinned, setShowPinned] = useState(false)

  const profilesById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m.profile])), [members])
  const memberProfiles = useMemo(() => members.map((m) => m.profile), [members])
  const isServerOwner = server.owner_id === user?.id
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const [confirmingBulk, setConfirmingBulk] = useState(false)

  // Troca de canal: o ChatArea NÃO remonta (mesmo componente, outro
  // `channel`), então tudo que é "deste canal" precisa ser zerado. Antes,
  // "respondendo a…", a thread aberta, a seleção de mensagens e os modais
  // de encaminhar/denunciar passavam pro canal seguinte — dava pra mandar
  // no canal B uma resposta apontando pra uma mensagem do canal A.
  const [stateChannelId, setStateChannelId] = useState(channel.id)
  if (stateChannelId !== channel.id) {
    setStateChannelId(channel.id)
    setReplyingTo(null)
    setActiveThread(null)
    setHighlightedMessageId(null)
    setForwardingMessageId(null)
    setReportingMessageId(null)
    setSelectionMode(false)
    setSelectedMessageIds(new Set())
    setShowPinned(false)
    setRevealedAdultChannelId(null)
  }

  const toggleSelectMessage = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const handleDelete = useCallback(
    async (messageId: string) => {
      const { error } = await deleteMessage(messageId)
      if (error) alert(error)
    },
    [deleteMessage]
  )
  const handlePin = useCallback(
    async (messageId: string) => {
      const { error } = await pinMessage(messageId)
      if (error) alert(error)
    },
    [pinMessage]
  )
  const handleUnpin = useCallback(
    async (messageId: string) => {
      const { error } = await unpinMessage(messageId)
      if (error) alert(error)
    },
    [unpinMessage]
  )

  async function handleBulkDelete() {
    if (selectedMessageIds.size === 0) return
    // Confirmação agora é inline na própria barra de seleção (confirmingBulk)
    setConfirmingBulk(false)
    const results = await Promise.all([...selectedMessageIds].map((id) => deleteMessage(id)))
    const failed = results.filter((r) => r.error).length
    if (failed > 0) alert(`${failed} mensagem(ns) não puderam ser excluídas.`)
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
    // Só descarta o "respondendo a…" se deu certo — antes sumia mesmo com
    // erro, e o reenvio ia sem a resposta.
    if (!result.error) {
      setReplyingTo(null)
      stopTyping()
    }
    return result
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-mv-main border-t border-l border-[var(--color-line)]">
      <header className="h-14 px-4 max-lg:pl-14 flex items-center gap-2 border-b border-[var(--color-line)] shrink-0">
        <span className="w-8 h-8 rounded-lg bg-white/[0.05] border border-[var(--color-line)] flex items-center justify-center shrink-0 text-mv-muted" aria-hidden="true">
          <TextChannelIcon className="w-[18px] h-[18px]" aria-hidden />
        </span>
        <h2 className="font-display font-semibold text-[15px] text-white shrink-0 truncate max-w-[40%]">{channel.name}</h2>
        {channel.is_nsfw && (
          <span
            title="Canal com restrição de idade (+18)"
            className="chip !text-rose-300 !bg-rose-500/10 !border-rose-500/25 shrink-0 tabular-nums"
          >
            +18
          </span>
        )}
        {channel.slowmode_seconds > 0 && (
          <span
            title={`Modo lento: ${channel.slowmode_seconds}s entre mensagens`}
            className="chip !text-amber-300 !bg-amber-400/10 !border-amber-400/20 shrink-0"
          >
            <ClockIcon className="w-3.5 h-3.5" aria-hidden />
            {channel.slowmode_seconds}s
          </span>
        )}
        {channel.topic && (
          <>
            <span className="w-px h-5 bg-[var(--color-line-strong)] mx-1.5 shrink-0 hidden sm:block" />
            <p className="text-[13px] text-mv-muted truncate flex-1 hidden sm:block" title={channel.topic}>{channel.topic}</p>
            <div className="flex-1 sm:hidden" />
          </>
        )}
        {!channel.topic && <div className="flex-1" />}
        <div className="flex items-center gap-0.5 shrink-0">
        {isServerOwner && (
          <button
            onClick={() => {
              setSelectionMode((v) => !v)
              setSelectedMessageIds(new Set())
            }}
            title="Selecionar mensagens"
            aria-label="Selecionar mensagens"
            aria-pressed={selectionMode}
            className={`icon-btn w-9 h-9 ${selectionMode ? '!text-mv-accent bg-mv-accent/10' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
              <path d="m8 12 3 3 5-6" />
            </svg>
          </button>
        )}
        <button
          onClick={() => setShowPinned(true)}
          title="Mensagens fixadas"
          aria-label="Mensagens fixadas"
          className="icon-btn w-9 h-9"
        >
          <PinIcon className="w-5 h-5" aria-hidden />
        </button>
        <button
          onClick={() => setShowSearch(true)}
          title="Pesquisar mensagens"
          aria-label="Pesquisar mensagens"
          className="icon-btn w-9 h-9"
        >
          <SearchIcon className="w-5 h-5" aria-hidden />
        </button>
        {onToggleMembers && (
          <button
            onClick={onToggleMembers}
            title={membersOpen ? 'Esconder lista de membros' : 'Mostrar lista de membros'}
            aria-label="Membros"
            aria-pressed={membersOpen}
            className={`icon-btn w-9 h-9 ${membersOpen ? 'lg:!text-white lg:!bg-white/[0.08]' : ''}`}
          >
            <MembersIcon className="w-5 h-5" aria-hidden />
          </button>
        )}
        </div>
      </header>

      {isAdultGated ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
          <div className="absolute inset-0 backdrop-blur-2xl bg-mv-main/70" />
          <div
            role="alertdialog"
            aria-labelledby="adult-gate-title"
            aria-describedby="adult-gate-desc"
            className="relative z-10 flex flex-col items-center gap-3 text-center px-6 py-8 max-w-sm surface-elevated rounded-2xl animate-pop-in"
          >
            <span className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center font-display font-bold text-lg text-rose-300 tabular-nums" aria-hidden="true">
              +18
            </span>
            <p id="adult-gate-title" className="font-display text-white font-semibold">Canal com restrição de idade</p>
            <p id="adult-gate-desc" className="text-sm text-mv-muted -mt-1">
              Este canal tem conteúdo adulto. Você confirma que tem 18 anos ou mais?
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              <button
                onClick={() => {
                  // Leva pro primeiro canal de texto comum do servidor; se
                  // não houver, o conteúdo simplesmente continua oculto.
                  const fallback = channels.find(
                    (c) => c.server_id === server.id && c.type === 'text' && !c.is_nsfw && c.id !== channel.id
                  )
                  if (fallback) onJumpToChannel(fallback)
                }}
                className="h-10 px-5 btn-secondary text-sm"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  setRevealedAdultChannelId(channel.id)
                  // O banco só libera as mensagens de canal +18 depois que
                  // a confirmação está salva (RLS, migration 016) — por
                  // isso recarrega a lista quando ela termina.
                  void adultContent.confirmAdult().then(({ error }) => {
                    if (error) alert(error)
                    else refresh()
                  })
                }}
                className="h-10 px-5 btn-primary text-sm"
              >
                Sou maior de 18, continuar
              </button>
            </div>
            <p className="text-[11.5px] text-mv-muted leading-snug">
              Dá pra rever essa escolha em Configurações › Privacidade.
            </p>
          </div>
        </div>
      ) : isSpoilerHidden ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
          <div className="absolute inset-0 backdrop-blur-2xl bg-mv-main/70" />
          <div className="relative z-10 flex flex-col items-center gap-3 text-center px-6 py-8 max-w-sm surface-elevated rounded-2xl animate-pop-in">
            <span className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
              <LockIcon className="w-7 h-7 text-amber-300" aria-hidden />
            </span>
            <p className="font-display text-white font-semibold">Conteúdo com spoiler</p>
            <p className="text-sm text-mv-muted -mt-1">Este canal tem conteúdo marcado como spoiler.</p>
            <button
              onClick={() => setRevealedSpoilerChannelId(channel.id)}
              className="h-10 px-5 btn-primary text-sm mt-1"
            >
              Revelar conteúdo
            </button>
          </div>
        </div>
      ) : (
        <>

      <MessageList
        channelName={channel.name}
        viewKey={channel.id}
        messages={messages}
        loading={loading}
        loadingOlder={loadingOlder}
        hasMore={hasMore}
        onLoadOlder={loadOlder}
        loadError={loadError}
        onRetry={refresh}
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
        onDelete={handleDelete}
        onReply={setReplyingTo}
        onToggleReaction={toggleReaction}
        onViewProfile={onViewProfile}
        onPin={handlePin}
        onUnpin={handleUnpin}
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

      <div className="h-6 px-5 flex items-center gap-2 text-xs text-mv-muted shrink-0" aria-live="polite">
        {typingNames.length > 0 && (
          <>
            <span className="flex items-center gap-[3px] px-2 py-1 rounded-full bg-white/[0.05] border border-[var(--color-line)]">
              <span className="w-1.5 h-1.5 rounded-full bg-mv-muted animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mv-muted animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mv-muted animate-bounce" />
            </span>
            <span className="truncate animate-fade-in">
              {typingNames.length === 1 ? (
                <><strong className="font-semibold text-mv-text">{typingNames[0]}</strong> está digitando…</>
              ) : typingNames.length === 2 ? (
                <><strong className="font-semibold text-mv-text">{typingNames[0]}</strong> e <strong className="font-semibold text-mv-text">{typingNames[1]}</strong> estão digitando…</>
              ) : (
                `${typingNames.length} pessoas estão digitando…`
              )}
            </span>
          </>
        )}
      </div>

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
        adultGifs={!!channel.is_nsfw}
      />

      <Suspense fallback={null}>
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
          onUnpin={handleUnpin}
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
              // De um canal +18, só dá pra encaminhar pra outro canal +18
              // (o conteúdo adulto não vaza pros canais comuns).
              channels={channels.filter((c) => c.server_id === server.id && (!channel.is_nsfw || c.is_nsfw))}
              serverId={server.id}
              onClose={() => setForwardingMessageId(null)}
            />
          )
        })()}
      </Suspense>
      {selectionMode && selectedMessageIds.size > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] surface-elevated rounded-full pl-4 pr-1.5 py-1.5 flex items-center gap-2 animate-pop-in">
          <span className="text-sm text-mv-text font-medium tabular-nums">
            {confirmingBulk ? `Excluir ${selectedMessageIds.size} mensagem(ns)? Não dá pra desfazer.` : `${selectedMessageIds.size} selecionada(s)`}
          </span>
          <button
            onClick={confirmingBulk ? handleBulkDelete : () => setConfirmingBulk(true)}
            className="text-sm h-8 px-4 !rounded-full btn-danger"
          >
            {confirmingBulk ? 'Confirmar' : 'Excluir'}
          </button>
          <button
            onClick={() => {
              if (confirmingBulk) {
                setConfirmingBulk(false)
                return
              }
              setSelectionMode(false)
              setSelectedMessageIds(new Set())
            }}
            className="text-sm h-8 px-3 !rounded-full btn-ghost"
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
