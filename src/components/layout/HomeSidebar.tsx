import { describeMessageContent } from '../../lib/stickers'
import { Fragment, useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { useConversations } from '../../hooks/useConversations'
import { useGroupConversations } from '../../context/GroupConversationsContext'
import { usePinnedItems } from '../../hooks/usePinnedItems'
import { useAuth } from '../../hooks/useAuth'
import { lazyModal } from '../modals/lazyModal'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { ConfirmDialog } from '../modals/ConfirmDialog'

// Modais/painéis carregados só quando abertos (fora do pacote inicial).
const CreateGroupModal = lazyModal(() => import('../modals/CreateGroupModal').then((m) => m.CreateGroupModal))

export function HomeSidebar({
  view,
  activeConversationId,
  activeGroupId,
  unreadConversationIds,
  onSelectFriends,
  onSelectConversation,
  onSelectGroup,
}: {
  view: 'friends' | 'conversation' | 'group'
  activeConversationId: string | null
  activeGroupId: string | null
  unreadConversationIds: Set<string>
  onSelectFriends: () => void
  onSelectConversation: (conversationId: string) => void
  onSelectGroup: (groupId: string) => void
}) {
  const { user } = useAuth()
  const { conversations, loading, hideConversation } = useConversations()

  // Confirmação de "apagar conversa" agora é inline, logo abaixo da linha
  // (antes era um confirm() nativo).
  const [confirmingHide, setConfirmingHide] = useState<{ id: string; name: string } | null>(null)
  function handleDeleteConversation(e: React.MouseEvent, conversationId: string, otherName: string) {
    e.stopPropagation()
    setConfirmingHide({ id: conversationId, name: otherName })
  }
  async function confirmHideConversation(conversationId: string) {
    setConfirmingHide(null)
    const { error } = await hideConversation(conversationId)
    if (error) alert(`Não deu pra apagar a conversa: ${error}`)
  }
  const { groups, leaveGroup, deleteGroup } = useGroupConversations()

  // Menu de contexto (botão direito) dos grupos: fixar, sair e — só pra
  // quem criou — apagar o grupo inteiro. As duas ações destrutivas passam
  // pelo ConfirmDialog.
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [groupAction, setGroupAction] = useState<{ kind: 'leave' | 'delete'; id: string; name: string } | null>(null)
  const [groupActionError, setGroupActionError] = useState<string | null>(null)
  function openGroupMenu(e: React.MouseEvent, groupId: string) {
    e.preventDefault()
    e.stopPropagation()
    setGroupMenu({ id: groupId, x: e.clientX, y: e.clientY })
  }
  function groupMenuItems(groupId: string): ContextMenuItem[] {
    const g = groups.find((x) => x.id === groupId)
    if (!g) return []
    const name = groupTitle(g)
    const items: ContextMenuItem[] = [
      { label: pinnedIds.has(g.id) ? 'Desafixar' : 'Fixar no topo', onClick: () => togglePin(g.id) },
      {
        label: 'Sair do grupo',
        danger: true,
        divider: true,
        onClick: () => {
          setGroupActionError(null)
          setGroupAction({ kind: 'leave', id: g.id, name })
        },
      },
    ]
    if (user?.id && g.created_by === user.id) {
      items.push({
        label: 'Apagar grupo',
        danger: true,
        onClick: () => {
          setGroupActionError(null)
          setGroupAction({ kind: 'delete', id: g.id, name })
        },
      })
    }
    return items
  }
  async function confirmGroupAction() {
    if (!groupAction) return
    setGroupActionError(null)
    const { error } = groupAction.kind === 'delete' ? await deleteGroup(groupAction.id) : await leaveGroup(groupAction.id)
    if (error) {
      setGroupActionError(error)
      return
    }
    setGroupAction(null)
  }
  function groupTitle(g: (typeof groups)[number]) {
    const others = g.members.filter((m) => m.id !== user?.id)
    return g.name || others.map((m) => m.display_name || m.username).join(', ')
  }
  const { pinnedIds, toggle: togglePin } = usePinnedItems()
  const [showCreateGroup, setShowCreateGroup] = useState(false)

  const rowClass = (active: boolean, unread = false) =>
    `group relative w-full flex items-center gap-2.5 px-2 py-[6px] rounded-lg text-[14px] transition-colors ${
      active
        ? 'bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
        : unread
          ? 'text-white hover:bg-white/[0.04]'
          : 'text-mv-muted hover:bg-white/[0.04] hover:text-mv-text'
    }`
  const sectionLabel = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted'
  const rowAction =
    'shrink-0 w-6 h-6 rounded-md hidden group-hover:flex group-focus-visible:flex items-center justify-center'
  const PinIcon = (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
    </svg>
  )
  const TrashIcon = (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zM7 7h10v13H7V7zm2 2v9h2V9H9zm4 0v9h2V9h-2z" />
    </svg>
  )
  function renderHideConfirm(conversationId: string) {
    if (confirmingHide?.id !== conversationId) return null
    return (
      <div role="alertdialog" aria-label="Confirmar apagar conversa" className="mx-1 my-1 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-2.5 animate-fade-in">
        <p className="text-xs text-mv-text leading-snug">
          Apagar a conversa com <strong className="font-semibold">{confirmingHide.name}</strong>?
        </p>
        <p className="text-[11px] text-mv-muted mt-0.5 leading-snug">Se chegar mensagem nova, ela volta a aparecer.</p>
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => setConfirmingHide(null)} className="btn-ghost h-7 px-2.5 text-xs flex-1">
            Cancelar
          </button>
          <button autoFocus onClick={() => void confirmHideConversation(conversationId)} className="btn-danger h-7 px-2.5 text-xs flex-1">
            Apagar
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside className="w-64 bg-mv-side flex flex-col shrink-0 rounded-tl-[var(--radius-panel)] border-l border-t border-[var(--color-line)] overflow-hidden">
      <div className="h-14 px-4 flex items-center gap-2.5 border-b border-[var(--color-line)] shrink-0">
        <img src="/logo-192.png" alt="" className="w-7 h-7 rounded-lg object-cover shrink-0 ring-1 ring-[var(--color-line-strong)]" />
        <span className="font-display text-white font-semibold text-[15px] truncate">Mamacos Voip</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        <button
          onClick={onSelectFriends}
          aria-current={view === 'friends' ? 'page' : undefined}
          className={`${rowClass(view === 'friends')} font-medium !py-[7px]`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0">
            <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
          Amigos
        </button>

        {(() => {
          const pinnedConversations = conversations.filter((c) => pinnedIds.has(c.id))
          const pinnedGroups = groups.filter((g) => pinnedIds.has(g.id))
          if (pinnedConversations.length === 0 && pinnedGroups.length === 0) return null
          return (
            <div className="mt-5">
              <p className={`px-2 mb-1.5 ${sectionLabel} flex items-center gap-1.5`}>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden="true">
                  <path d="M16 3l5 5-3.5 3.5L19 14l-1.4 1.4-3.5-2.5L10.5 16.5 9 15l3.6-3.6L10 8.9 13.5 5.4 16 3z" />
                </svg>
                Fixados
              </p>
              <div className="space-y-0.5">
                {pinnedConversations.map((c) => (
                  <Fragment key={`pinned-conv-${c.id}`}>
                  <button
                    onClick={() => onSelectConversation(c.id)}
                    aria-current={view === 'conversation' && activeConversationId === c.id ? 'page' : undefined}
                    className={rowClass(view === 'conversation' && activeConversationId === c.id, unreadConversationIds.has(c.id))}
                  >
                    <Avatar name={c.otherProfile.username} avatarUrl={c.otherProfile.avatar_url} status={c.otherProfile.status} userId={c.otherProfile.id} size={32} />
                    <span className={`truncate flex-1 text-left ${unreadConversationIds.has(c.id) ? 'font-semibold' : 'font-medium'}`}>
                      {c.otherProfile.display_name || c.otherProfile.username}
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePin(c.id)
                      }}
                      title="Desafixar"
                      aria-label="Desafixar"
                      className={`${rowAction} text-amber-300 hover:bg-white/[0.08]`}
                    >
                      {PinIcon}
                    </span>
                    <span
                      onClick={(e) => handleDeleteConversation(e, c.id, c.otherProfile.display_name || c.otherProfile.username)}
                      title="Apagar conversa"
                      aria-label="Apagar conversa"
                      className={`${rowAction} text-mv-muted hover:text-rose-400 hover:bg-rose-500/10`}
                    >
                      {TrashIcon}
                    </span>
                    {unreadConversationIds.has(c.id) && (
                      <span className="w-2 h-2 rounded-full bg-mv-accent shrink-0" aria-label="Não lida" />
                    )}
                  </button>
                  {renderHideConfirm(c.id)}
                  </Fragment>
                ))}
                {pinnedGroups.map((g) => {
                  const others = g.members.filter((m) => m.id !== user?.id)
                  const title = g.name || others.map((m) => m.display_name || m.username).join(', ')
                  return (
                    <button
                      key={`pinned-group-${g.id}`}
                      onClick={() => onSelectGroup(g.id)}
                      onContextMenu={(e) => openGroupMenu(e, g.id)}
                      aria-current={view === 'group' && activeGroupId === g.id ? 'page' : undefined}
                      className={rowClass(view === 'group' && activeGroupId === g.id)}
                    >
                      <div className="flex -space-x-2.5 shrink-0 [&>*]:ring-2 [&>*]:ring-mv-side [&>*]:rounded-full">
                        {others.slice(0, 2).map((m) => (
                          <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={26} />
                        ))}
                      </div>
                      <span className="truncate font-medium text-left flex-1">{title}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePin(g.id)
                        }}
                        title="Desafixar"
                        aria-label="Desafixar"
                        className={`${rowAction} text-amber-300 hover:bg-white/[0.08]`}
                      >
                        {PinIcon}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}

        <div className="px-2 mt-5 mb-1.5 flex items-center justify-between">
          <span className={sectionLabel}>Mensagens diretas</span>
        </div>

        {loading ? (
          <div className="space-y-0.5" role="status" aria-label="Carregando conversas">
            {[60, 45, 70].map((w, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-[6px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="w-8 h-8 rounded-full bg-white/[0.06] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 rounded-full bg-white/[0.06]" style={{ width: `${w}%` }} />
                  <div className="h-2 rounded-full bg-white/[0.04]" style={{ width: `${w + 15}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.filter((c) => !pinnedIds.has(c.id)).length === 0 ? (
          <div className="mx-1 px-3 py-4 rounded-xl border border-dashed border-[var(--color-line-strong)] text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 mx-auto text-mv-muted" aria-hidden="true">
              <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />
              <path d="M8 10h8M8 13h5" />
            </svg>
            <p className="text-xs font-medium text-mv-text mt-2">Nenhuma conversa ainda</p>
            <p className="text-[11px] text-mv-muted mt-0.5">Mande mensagem pra um amigo pra começar.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {conversations.filter((c) => !pinnedIds.has(c.id)).map((c) => {
              const unread = unreadConversationIds.has(c.id)
              return (
              <Fragment key={c.id}>
              <button
                onClick={() => onSelectConversation(c.id)}
                aria-current={view === 'conversation' && activeConversationId === c.id ? 'page' : undefined}
                className={rowClass(view === 'conversation' && activeConversationId === c.id, unread)}
              >
                {unread && <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-mv-text" aria-hidden="true" />}
                <Avatar
                  name={c.otherProfile.username}
                  avatarUrl={c.otherProfile.avatar_url}
                  decorationUrl={c.otherProfile.avatar_decoration_url}
                  status={c.otherProfile.status}
                  userId={c.otherProfile.id}
                  size={32}
                />
                <div className="min-w-0 text-left flex-1 leading-tight">
                  <p className={`truncate ${unread ? 'font-semibold' : 'font-medium'}`}>{c.otherProfile.display_name || c.otherProfile.username}</p>
                  {c.lastMessage && (
                    <p className={`truncate text-xs mt-0.5 ${unread ? 'text-mv-text' : 'text-mv-muted'}`}>{describeMessageContent(c.lastMessage.content)}</p>
                  )}
                </div>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePin(c.id)
                  }}
                  title={pinnedIds.has(c.id) ? 'Desafixar' : 'Fixar no topo'}
                  aria-label={pinnedIds.has(c.id) ? 'Desafixar' : 'Fixar no topo'}
                  className={`${rowAction} ${pinnedIds.has(c.id) ? '!flex text-amber-300' : 'text-mv-muted hover:text-white hover:bg-white/[0.08]'}`}
                >
                  {PinIcon}
                </span>
                <span
                  onClick={(e) => handleDeleteConversation(e, c.id, c.otherProfile.display_name || c.otherProfile.username)}
                  title="Apagar conversa"
                  aria-label="Apagar conversa"
                  className={`${rowAction} text-mv-muted hover:text-rose-400 hover:bg-rose-500/10`}
                >
                  {TrashIcon}
                </span>
                {unread && <span className="w-2 h-2 rounded-full bg-mv-accent shrink-0 group-hover:hidden" aria-label="Não lida" />}
              </button>
              {renderHideConfirm(c.id)}
              </Fragment>
              )
            })}
          </div>
        )}

        <div className="px-2 mt-5 mb-1.5 flex items-center justify-between">
          <span className={sectionLabel}>Grupos</span>
          <button
            onClick={() => setShowCreateGroup(true)}
            title="Criar grupo"
            aria-label="Criar grupo"
            className="icon-btn w-6 h-6 !rounded-md"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M12 2a1 1 0 0 1 1 1v8h8a1 1 0 1 1 0 2h-8v8a1 1 0 1 1-2 0v-8H3a1 1 0 1 1 0-2h8V3a1 1 0 0 1 1-1z" />
            </svg>
          </button>
        </div>

        {groups.filter((g) => !pinnedIds.has(g.id)).length === 0 ? (
          <button
            onClick={() => setShowCreateGroup(true)}
            className="w-full mx-0 px-3 py-3 rounded-xl border border-dashed border-[var(--color-line-strong)] text-left flex items-center gap-3 text-mv-muted hover:text-mv-text hover:bg-white/[0.03] transition-colors"
          >
            <span className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                <path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-xs font-medium text-mv-text">Nenhum grupo ainda</span>
              <span className="block text-[11px] mt-0.5">Crie um pra conversar com vários amigos.</span>
            </span>
          </button>
        ) : (
          <div className="space-y-0.5">
            {groups.filter((g) => !pinnedIds.has(g.id)).map((g) => {
              const others = g.members.filter((m) => m.id !== user?.id)
              const title = g.name || others.map((m) => m.display_name || m.username).join(', ')
              return (
                <button
                  key={g.id}
                  onClick={() => onSelectGroup(g.id)}
                  onContextMenu={(e) => openGroupMenu(e, g.id)}
                  aria-current={view === 'group' && activeGroupId === g.id ? 'page' : undefined}
                  className={rowClass(view === 'group' && activeGroupId === g.id)}
                >
                  <div className="flex -space-x-2.5 shrink-0 [&>*]:ring-2 [&>*]:ring-mv-side [&>*]:rounded-full">
                    {others.slice(0, 2).map((m) => (
                      <Avatar key={m.id} name={m.username} avatarUrl={m.avatar_url} size={26} />
                    ))}
                  </div>
                  <div className="min-w-0 text-left flex-1 leading-tight">
                    <p className="truncate font-medium">{title}</p>
                    <p className="truncate text-xs mt-0.5 text-mv-muted">{g.members.length} membros</p>
                  </div>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePin(g.id)
                    }}
                    title="Fixar no topo"
                    aria-label="Fixar no topo"
                    className={`${rowAction} text-mv-muted hover:text-white hover:bg-white/[0.08]`}
                  >
                    {PinIcon}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {groupMenu && (
        <ContextMenu x={groupMenu.x} y={groupMenu.y} items={groupMenuItems(groupMenu.id)} onClose={() => setGroupMenu(null)} />
      )}

      {groupAction && (
        <ConfirmDialog
          title={groupAction.kind === 'delete' ? 'Apagar grupo' : 'Sair do grupo'}
          danger
          confirmLabel={groupAction.kind === 'delete' ? 'Apagar para todos' : 'Sair'}
          message={
            <>
              <p>
                {groupAction.kind === 'delete' ? (
                  <>
                    Apagar <strong className="text-white font-semibold">{groupAction.name || 'este grupo'}</strong> para
                    todos os membros? Todas as mensagens e arquivos serão apagados e isso não pode ser desfeito.
                  </>
                ) : (
                  <>
                    Sair de <strong className="text-white font-semibold">{groupAction.name || 'este grupo'}</strong>? Você
                    não verá mais as mensagens.
                  </>
                )}
              </p>
              {groupActionError && (
                <p role="alert" className="mt-2 text-rose-400 text-[13px]">
                  {groupActionError}
                </p>
              )}
            </>
          }
          onConfirm={confirmGroupAction}
          onCancel={() => setGroupAction(null)}
        />
      )}

      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={(groupId) => {
            setShowCreateGroup(false)
            onSelectGroup(groupId)
          }}
        />
      )}
    </aside>
  )
}
