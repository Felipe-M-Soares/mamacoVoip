import { useRef, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { ContextMenu, useContextMenuState, type ContextMenuItem } from '../ui/ContextMenu'
import { useFriends } from '../../context/FriendsContext'
import { useConversations } from '../../hooks/useConversations'
import { useOnlineIds } from '../../hooks/usePresence'
import { useAuth } from '../../hooks/useAuth'
import { useVoiceCore } from '../../hooks/useVoice'
import { useServers } from '../../hooks/useServers'
import { supabase } from '../../lib/supabase'
import { buildInviteMessage } from '../../lib/inviteMessage'
import type { ProfileStatus } from '../../types/database'
import { AddFriendIcon, CheckIcon, CloseIcon, MembersIcon, MessageIcon, RemoveFriendIcon, WarningIcon } from '../ui/icons'

type Tab = 'online' | 'all' | 'pending' | 'blocked'

export function FriendsPanel({ onOpenConversation }: { onOpenConversation: (conversationId: string) => void }) {
  const { friends, incoming, outgoing, blocked, sendRequest, acceptRequest, declineRequest, removeFriend, unblockUser } =
    useFriends()
  const { openConversationWith } = useConversations()
  const [tab, setTab] = useState<Tab>('online')
  const [addUsername, setAddUsername] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)

  const onlineIds = useOnlineIds()
  // Mesmo cruzamento de MemberList.tsx: só conta como "online" quem não
  // escolheu ficar invisível E está de fato conectado agora (ver
  // usePresence.ts) — evita amigo desconectado ficando preso na aba
  // "Online" pra sempre.
  const onlineFriends = friends.filter((f) => f.profile.status !== 'offline' && onlineIds.has(f.profile.id))
  const pendingCount = incoming.length + outgoing.length

  async function handleSendRequest() {
    setAddError(null)
    setAddSuccess(null)
    if (addUsername.trim().length === 0) return
    const { error } = await sendRequest(addUsername.trim())
    if (error) {
      setAddError(error)
      return
    }
    setAddSuccess(`Pedido enviado para ${addUsername.trim()}!`)
    setAddUsername('')
  }

  async function handleMessage(userId: string) {
    const { conversation } = await openConversationWith(userId)
    if (conversation) onOpenConversation(conversation.id)
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'Pendentes', count: pendingCount },
    { id: 'blocked', label: 'Bloqueados' },
  ]

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-mv-main border-t border-l border-[var(--color-line)]">
      <header className="h-14 px-4 max-lg:pl-14 flex items-center gap-4 border-b border-[var(--color-line)] shrink-0 min-w-0">
        <div className="flex items-center gap-2.5 text-white shrink-0">
          <span className="w-8 h-8 rounded-lg bg-white/[0.05] border border-[var(--color-line)] flex items-center justify-center" aria-hidden="true">
            <MembersIcon className="w-[18px] h-[18px] text-mv-muted" aria-hidden />
          </span>
          <h2 className="font-display font-semibold text-[15px] hidden sm:block">Amigos</h2>
        </div>
        <div className="w-px h-5 bg-[var(--color-line-strong)] shrink-0 hidden sm:block" />
        <div
          role="tablist"
          aria-label="Filtrar amigos"
          className="flex items-center gap-0.5 p-1 rounded-xl bg-mv-canvas/70 border border-[var(--color-line)] overflow-x-auto min-w-0"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`h-7 px-3 rounded-lg text-[13px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                tab === t.id
                  ? 'bg-mv-raised text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                  : 'text-mv-muted hover:text-mv-text hover:bg-white/[0.04]'
              }`}
            >
              {t.label}
              {t.count ? <span className="badge-count !shadow-none !h-4 !min-w-4 !leading-4 !text-[10px]">{t.count}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6 max-w-4xl">
        <div className="rounded-2xl border border-[var(--color-line)] bg-white/[0.02] p-4 sm:p-5 mb-6">
          <div className="flex items-start gap-3 mb-3">
            <span className="w-9 h-9 rounded-xl bg-brand-gradient flex items-center justify-center shrink-0" aria-hidden="true">
              <AddFriendIcon className="w-[18px] h-[18px] text-white" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="font-display font-semibold text-white">Adicionar amigo</h3>
              <p className="text-[13px] text-mv-muted">Envie um pedido usando o nome de usuário da pessoa.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="add-friend-input" className="sr-only">Nome de usuário</label>
            <input
              id="add-friend-input"
              type="text"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
              placeholder="Digite um nome de usuário"
              className="flex-1 min-w-0 px-3 py-2.5 bg-mv-canvas text-mv-text outline-none text-sm"
            />
            <button
              onClick={handleSendRequest}
              disabled={addUsername.trim().length === 0}
              className="h-10 px-5 btn-primary text-sm shrink-0"
            >
              Enviar pedido
            </button>
          </div>
          {addError && (
            <p role="alert" className="text-sm text-rose-400 mt-2.5 flex items-center gap-1.5">
              <WarningIcon className="w-4 h-4 shrink-0" aria-hidden />
              {addError}
            </p>
          )}
          {addSuccess && (
            <p role="status" className="text-sm text-mv-green mt-2.5 flex items-center gap-1.5">
              <CheckIcon className="w-4 h-4 shrink-0" strokeWidth={2.5} aria-hidden />
              {addSuccess}
            </p>
          )}
        </div>

        {tab === 'online' && (
          <FriendGrid
            friends={onlineFriends}
            label="Online"
            empty={<EmptyState kind="online" title="Ninguém online agora" hint="Quando seus amigos entrarem, eles aparecem aqui." />}
            onMessage={handleMessage}
            onRemove={removeFriend}
          />
        )}
        {tab === 'all' && (
          <FriendGrid
            friends={friends}
            label="Todos os amigos"
            empty={<EmptyState kind="friends" title="Você ainda não tem amigos" hint="Adicione alguém pelo nome de usuário aqui em cima." />}
            onMessage={handleMessage}
            onRemove={removeFriend}
          />
        )}
        {tab === 'pending' && (
          <div className="space-y-6">
            {incoming.length > 0 && (
              <div>
                <p className={`${SECTION_LABEL} px-2 mb-2`}>
                  Pedidos recebidos — {incoming.length}
                </p>
                <div className="space-y-0.5">
                  {incoming.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/[0.04] transition-colors border-t border-[var(--color-line)] first:border-t-0">
                      <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} decorationUrl={req.profile.avatar_decoration_url} size={40} />
                      <div className="flex-1 min-w-0 leading-tight">
                        <span className="text-[14px] font-semibold text-white truncate block">
                          {req.profile.display_name || req.profile.username}
                        </span>
                        {req.request_note ? (
                          <span className="text-xs text-mv-muted italic truncate block mt-0.5">
                            "{req.request_note}"
                          </span>
                        ) : (
                          <span className="text-xs text-mv-muted truncate block mt-0.5">Pedido de amizade recebido</span>
                        )}
                      </div>
                      <button
                        onClick={() => acceptRequest(req.id)}
                        title="Aceitar"
                        aria-label={`Aceitar pedido de ${req.profile.display_name || req.profile.username}`}
                        className="icon-btn w-9 h-9 !rounded-full bg-white/[0.05] hover:!bg-mv-green/15 hover:!text-mv-green"
                      >
                        <CheckIcon className="w-[18px] h-[18px]" strokeWidth={2.5} aria-hidden />
                      </button>
                      <button
                        onClick={() => declineRequest(req.id)}
                        title="Recusar"
                        aria-label={`Recusar pedido de ${req.profile.display_name || req.profile.username}`}
                        className="icon-btn w-9 h-9 !rounded-full bg-white/[0.05] hover:!bg-rose-500/15 hover:!text-rose-400"
                      >
                        <CloseIcon className="w-[18px] h-[18px]" strokeWidth={2.5} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {outgoing.length > 0 && (
              <div>
                <p className={`${SECTION_LABEL} px-2 mb-2`}>
                  Pedidos enviados — {outgoing.length}
                </p>
                <div className="space-y-0.5">
                  {outgoing.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/[0.04] transition-colors border-t border-[var(--color-line)] first:border-t-0">
                      <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} decorationUrl={req.profile.avatar_decoration_url} size={40} />
                      <div className="flex-1 min-w-0 leading-tight">
                        <span className="text-[14px] font-semibold text-white truncate block">
                          {req.profile.display_name || req.profile.username}
                        </span>
                        <span className="text-xs text-mv-muted truncate block mt-0.5">@{req.profile.username}</span>
                      </div>
                      <span className="chip">Aguardando</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {incoming.length === 0 && outgoing.length === 0 && (
              <EmptyState kind="pending" title="Nenhum pedido pendente" hint="Pedidos que você enviar ou receber aparecem aqui." />
            )}
          </div>
        )}
        {tab === 'blocked' && (
          <div>
            {blocked.length === 0 ? (
              <EmptyState kind="blocked" title="Ninguém bloqueado" hint="Você não bloqueou ninguém. Bom sinal!" />
            ) : (
              <>
              <p className={`${SECTION_LABEL} px-2 mb-2`}>Bloqueados — {blocked.length}</p>
              <div className="space-y-0.5">
              {blocked.map((b) => (
                <div key={b.blocked_id} className="flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/[0.04] transition-colors border-t border-[var(--color-line)] first:border-t-0">
                  <Avatar name={b.profile.username} avatarUrl={b.profile.avatar_url} decorationUrl={b.profile.avatar_decoration_url} size={40} />
                  <div className="flex-1 min-w-0 leading-tight">
                    <span className="text-[14px] font-semibold text-white truncate block">
                      {b.profile.display_name || b.profile.username}
                    </span>
                    <span className="text-xs text-mv-muted truncate block mt-0.5">@{b.profile.username}</span>
                  </div>
                  <button
                    onClick={() => unblockUser(b.blocked_id)}
                    className="h-8 px-3 btn-secondary text-xs"
                  >
                    Desbloquear
                  </button>
                </div>
              ))}
              </div>
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </section>
  )
}

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted'

const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
  invisible: 'Offline',
}

// Ilustração simples (SVG inline) + título + dica, no lugar do texto cinza solto.
function EmptyState({ kind, title, hint }: { kind: 'online' | 'friends' | 'pending' | 'blocked'; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-4 animate-fade-in">
      <div className="relative w-28 h-28 mb-5" aria-hidden="true">
        <div className="absolute inset-0 rounded-full bg-mv-accent/10 blur-2xl" />
        <svg viewBox="0 0 112 112" className="relative w-full h-full" fill="none">
          <circle cx="56" cy="56" r="52" className="fill-white/[0.03] stroke-[var(--color-line-strong)]" strokeWidth="1.5" strokeDasharray="4 6" />
          {kind === 'online' && (
            <>
              <circle cx="56" cy="46" r="14" className="fill-mv-raised" />
              <path d="M30 82c3-13 14-20 26-20s23 7 26 20" className="fill-mv-raised" />
              <circle cx="72" cy="58" r="7" className="fill-mv-main" />
              <circle cx="72" cy="58" r="4.5" className="fill-zinc-500" />
            </>
          )}
          {kind === 'friends' && (
            <>
              <circle cx="44" cy="48" r="11" className="fill-mv-raised" />
              <path d="M24 80c2-11 10-17 20-17s18 6 20 17" className="fill-mv-raised" />
              <circle cx="70" cy="44" r="9" className="fill-mv-raised opacity-60" />
              <path d="M58 70c3-6 7-9 12-9 8 0 14 5 16 14" className="fill-mv-raised opacity-60" />
              <circle cx="82" cy="30" r="9" className="fill-mv-accent" />
              <path d="M82 25.5v9M77.5 30h9" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            </>
          )}
          {kind === 'pending' && (
            <>
              <rect x="28" y="36" width="56" height="40" rx="8" className="fill-mv-raised" />
              <path d="m30 40 26 19 26-19" className="stroke-mv-main" strokeWidth="3" strokeLinejoin="round" />
              <circle cx="80" cy="34" r="9" className="fill-mv-main" />
              <circle cx="80" cy="34" r="7" className="stroke-mv-accent" strokeWidth="2" />
              <path d="M80 30.5V34l2.5 1.5" className="stroke-mv-accent" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
          {kind === 'blocked' && (
            <>
              <circle cx="56" cy="56" r="22" className="stroke-mv-raised" strokeWidth="7" />
              <path d="m41 71 30-30" className="stroke-mv-raised" strokeWidth="7" strokeLinecap="round" />
            </>
          )}
        </svg>
      </div>
      <p className="font-display font-semibold text-white">{title}</p>
      <p className="text-sm text-mv-muted mt-1 max-w-xs">{hint}</p>
    </div>
  )
}

function FriendGrid({
  friends,
  label,
  empty,
  onMessage,
  onRemove,
}: {
  friends: {
    profile: {
      id: string
      username: string
      display_name: string | null
      avatar_url: string | null
      avatar_decoration_url: string | null
      status: ProfileStatus
      custom_status: string | null
    }
  }[]
  label: string
  empty: React.ReactNode
  onMessage: (userId: string) => void
  onRemove: (userId: string) => void
}) {
  const { user } = useAuth()
  const voice = useVoiceCore()
  const { servers, createInvite } = useServers()
  const { openConversationWith } = useConversations()
  const { menuState, openMenu, closeMenu } = useContextMenuState()
  const [contextFriendId, setContextFriendId] = useState<string | null>(null)
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null)
  // Confirmação inline de "remover amigo" (antes removia num clique só)
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null)
  const feedbackTimeoutRef = useRef<number | null>(null)

  // Clicar com o botão direito num amigo online e chamá-lo direto pra um
  // dos MEUS servidores — igual o "Chamar para" que um app de chat popular tem no
  // menu de contexto de um amigo. Reusa exatamente a mesma lógica de
  // convite (gerar código + mandar por DM) que InviteFriendsModal.tsx já
  // usa, só que direcionada a UM amigo e UM servidor escolhidos aqui, em
  // vez do fluxo em modal com checkboxes.
  async function handleInviteToServer(friendId: string, serverId: string, serverName: string) {
    if (!user) return
    if (feedbackTimeoutRef.current) window.clearTimeout(feedbackTimeoutRef.current)
    const { error: inviteError, invite } = await createInvite(serverId, undefined, 24 * 7)
    if (inviteError || !invite) {
      setInviteFeedback('Não foi possível gerar o convite.')
    } else {
      // Se eu já estou numa call DE VOZ nesse mesmo servidor no momento
      // de chamar, o convite carrega o canal — quem aceitar cai direto
      // na chamada (ver MainLayout.tsx/InviteMessageCard.tsx), em vez de
      // só entrar no servidor e ter que procurar a sala sozinho. Fora de
      // uma call (ou numa call de OUTRO servidor), continua sendo um
      // convite normal, sem canal nenhum.
      let channelId: string | undefined
      let channelName: string | undefined
      if (voice.connectedServerId === serverId && voice.connectedChannelId) {
        channelId = voice.connectedChannelId
        const { data: channelRow } = await supabase
          .from('channels')
          .select('name')
          .eq('id', channelId)
          .single()
        channelName = channelRow?.name
      }
      const message = buildInviteMessage({ code: invite.code, serverId, serverName, channelId, channelName })
      const { conversation } = await openConversationWith(friendId)
      if (conversation) {
        await supabase
          .from('dm_messages')
          .insert({ conversation_id: conversation.id, author_id: user.id, content: message })
        setInviteFeedback(`Convite pra "${serverName}" enviado!`)
      } else {
        setInviteFeedback('Não foi possível enviar o convite.')
      }
    }
    feedbackTimeoutRef.current = window.setTimeout(() => setInviteFeedback(null), 3000)
  }

  if (friends.length === 0) {
    return <>{empty}</>
  }

  const contextTarget = friends.find((f) => f.profile.id === contextFriendId) ?? null
  const menuItems: ContextMenuItem[] = contextTarget
    ? [
        { label: 'Enviar mensagem', onClick: () => onMessage(contextTarget.profile.id) },
        ...(servers.length > 0
          ? servers.map((s) => ({
              label: `Chamar para "${s.name}"`,
              onClick: () => handleInviteToServer(contextTarget.profile.id, s.id, s.name),
            }))
          : [{ label: 'Você ainda não tem servidores', onClick: () => {}, disabled: true }]),
        {
          label: 'Remover amigo',
          danger: true,
          divider: true,
          onClick: () => setConfirmingRemoveId(contextTarget.profile.id),
        },
      ]
    : []

  return (
    <div>
      <p className={`${SECTION_LABEL} px-2 mb-2`}>
        {label} — {friends.length}
      </p>
      <div className="space-y-0.5">
      {friends.map((f) => (
        <div key={f.profile.id}>
        <div
          className="flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/[0.04] transition-colors group border-t border-[var(--color-line)] hover:border-transparent"
          onContextMenu={(e) => {
            setContextFriendId(f.profile.id)
            openMenu(e)
          }}
        >
          <Avatar
            name={f.profile.username}
            avatarUrl={f.profile.avatar_url}
            decorationUrl={f.profile.avatar_decoration_url}
            status={f.profile.status}
            userId={f.profile.id}
            size={40}
          />
          <div className="flex-1 min-w-0 leading-tight">
            <p className="text-[14px] font-semibold text-white truncate">
              {f.profile.display_name || f.profile.username}
              <span className="ml-1.5 text-xs font-normal text-mv-muted opacity-0 group-hover:opacity-100 transition-opacity">@{f.profile.username}</span>
            </p>
            <p className="text-xs text-mv-muted truncate mt-0.5">
              {f.profile.custom_status || STATUS_LABEL[f.profile.status] || f.profile.status}
            </p>
          </div>
          <button
            onClick={() => onMessage(f.profile.id)}
            title="Enviar mensagem"
            aria-label={`Enviar mensagem para ${f.profile.display_name || f.profile.username}`}
            className="icon-btn w-9 h-9 !rounded-full bg-white/[0.05] group-hover:bg-mv-canvas"
          >
            <MessageIcon className="w-[18px] h-[18px]" aria-hidden />
          </button>
          <button
            onClick={() => setConfirmingRemoveId(f.profile.id)}
            title="Remover amigo"
            aria-label={`Remover ${f.profile.display_name || f.profile.username} dos amigos`}
            className="icon-btn w-9 h-9 !rounded-full bg-white/[0.05] group-hover:bg-mv-canvas hover:!text-rose-400 hover:!bg-rose-500/15"
          >
            <RemoveFriendIcon className="w-[18px] h-[18px]" aria-hidden />
          </button>
        </div>
        {confirmingRemoveId === f.profile.id && (
          <div role="alertdialog" aria-label="Confirmar remoção" className="ml-14 mr-2 mb-2 mt-1 flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 animate-fade-in">
            <span className="text-sm text-mv-text flex-1 min-w-[10rem]">
              Remover <strong className="font-semibold">{f.profile.display_name || f.profile.username}</strong> dos amigos?
            </span>
            <button onClick={() => setConfirmingRemoveId(null)} className="btn-ghost h-8 px-3 text-sm">
              Cancelar
            </button>
            <button
              autoFocus
              onClick={() => {
                setConfirmingRemoveId(null)
                onRemove(f.profile.id)
              }}
              className="btn-danger h-8 px-3 text-sm"
            >
              Remover
            </button>
          </div>
        )}
        </div>
      ))}
      </div>

      {menuState && contextTarget && <ContextMenu x={menuState.x} y={menuState.y} items={menuItems} onClose={closeMenu} />}

      {inviteFeedback && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[210] surface-elevated text-white text-sm px-4 py-2.5 rounded-xl animate-pop-in">
          {inviteFeedback}
        </div>
      )}
    </div>
  )
}
