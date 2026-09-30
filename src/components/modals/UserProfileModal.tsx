import { useState } from 'react'
import { Modal } from './Modal'
import { ReportModal } from './ReportModal'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useFriends } from '../../context/FriendsContext'
import { useConversations } from '../../hooks/useConversations'
import { useIsPresent } from '../../hooks/usePresence'
import { useRoles } from '../../hooks/useRoles'
import { getUserNote, setUserNote } from '../../lib/pinnedItems'
import type { Profile } from '../../types/database'
import { useAvatarTransparent } from '../../hooks/useAvatarTransparent'

// Mesmo truque de gradiente-por-nome de ProfileSidePanel.tsx/ServerBar.tsx.
function gradientFor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue} 70% 40%), hsl(${(hue + 45) % 360} 65% 22%))`
}

export function UserProfileModal({
  targetProfile,
  onClose,
  onOpenConversation,
  serverId,
}: {
  targetProfile: Profile
  onClose: () => void
  onOpenConversation: (conversationId: string) => void
  serverId?: string
}) {
  const { user } = useAuth()
  const { friends, incoming, outgoing, blocked, sendRequest, acceptRequest, declineRequest, removeFriend, blockUser, unblockUser } =
    useFriends()
  const { openConversationWith } = useConversations()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  // Só leitura, pra mostrar os cargos da pessoa como chips (quando o
  // perfil é aberto de dentro de um servidor).
  const { rolesForUser } = useRoles(serverId ?? null)
  const memberRoles = serverId ? rolesForUser(targetProfile.id) : []
  const avatarTransparent = useAvatarTransparent(targetProfile.avatar_url)

  // "Jogando X" fica desatualizado assim que a pessoa fecha o app (o
  // campo playing no perfil só é limpo na próxima vez que ela abrir um
  // jogo, não quando ela sai) — por isso só mostra enquanto ela está
  // efetivamente online agora (o mesmo critério usado em MemberList.tsx).
  const isPresent = useIsPresent(targetProfile.id)
  const isEffectivelyOnline = targetProfile.status !== 'offline' && isPresent
  const isSelf = targetProfile.id === user?.id
  const friendship = friends.find((f) => f.profile.id === targetProfile.id)
  const incomingRequest = incoming.find((f) => f.profile.id === targetProfile.id)
  const outgoingRequest = outgoing.find((f) => f.profile.id === targetProfile.id)
  const isBlocked = blocked.some((b) => b.profile.id === targetProfile.id)
  const isFriend = Boolean(friendship) && friendship?.status === 'accepted'
  const isRestricted = !isSelf && !isFriend && targetProfile.profile_visibility === 'friends_only'

  async function handleMessage() {
    setLoading(true)
    const { error, conversation } = await openConversationWith(targetProfile.id)
    setLoading(false)
    if (error || !conversation) {
      setError(error ?? 'Não foi possível iniciar a conversa')
      return
    }
    onOpenConversation(conversation.id)
    onClose()
  }

  async function handleAction(action: () => Promise<{ error: string | null }>) {
    setError(null)
    setLoading(true)
    const { error } = await action()
    setLoading(false)
    if (error) setError(error)
  }

  const outlineBtn =
    'h-9 px-4 text-sm font-medium rounded-[10px] border border-[var(--color-line-strong)] text-mv-text hover:bg-white/[0.05] transition-colors disabled:opacity-60'

  return (
    <Modal title={`Perfil de ${targetProfile.display_name || targetProfile.username}`} onClose={onClose} headerless>
      {/* Mesmo fallback de gradiente-por-nome de ProfileSidePanel.tsx —
          se a pessoa não enviou um banner de verdade, mostra a mesma cor
          consistente que aparece em todo canto que o perfil dela é
          exibido, em vez de um espaço genérico vazio aqui. */}
      <div
        className="h-28 bg-cover bg-center"
        style={
          targetProfile.banner_url
            ? { backgroundImage: `url(${targetProfile.banner_url})` }
            : { background: gradientFor(targetProfile.username) }
        }
      />
      <div className="px-5 pb-5">
        <div className="flex items-end justify-between gap-3 -mt-11">
          <div className={avatarTransparent ? '' : 'rounded-full ring-[6px] ring-[var(--color-elevated)] bg-[var(--color-elevated)]'}>
            <Avatar
              name={targetProfile.username}
              avatarUrl={targetProfile.avatar_url}
              decorationUrl={targetProfile.avatar_decoration_url}
              status={targetProfile.status}
              userId={targetProfile.id}
              size={80}
            />
          </div>
          {isFriend && <span className="chip mb-1">Amigo</span>}
        </div>

        <div className="mt-3 rounded-xl bg-mv-canvas/60 border border-[var(--color-line)] p-4">
          <h3 className="font-display text-xl font-semibold text-white leading-tight">
            {targetProfile.display_name || targetProfile.username}
          </h3>
          <p className="text-[13px] text-mv-muted">@{targetProfile.username}</p>
          {isRestricted ? (
            <p className="text-[12.5px] text-mv-muted mt-3 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
                <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              </svg>
              Este perfil é privado — só amigos veem mais detalhes
            </p>
          ) : (
            <>
              {(targetProfile.custom_status || (targetProfile.playing && isEffectivelyOnline)) && (
                <div className="mt-3 pt-3 border-t border-[var(--color-line)] space-y-1.5">
                  {targetProfile.custom_status && (
                    <p className="text-[14px] text-mv-text">{targetProfile.custom_status}</p>
                  )}
                  {targetProfile.playing && isEffectivelyOnline && (
                    <p className="text-[13px] text-mv-muted flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-mv-green shrink-0">
                        <rect x="2.5" y="7" width="19" height="11" rx="4" />
                        <path d="M7.5 11v3M6 12.5h3M15.5 12h.01M18 13.5h.01" />
                      </svg>
                      Jogando <span className="text-mv-text font-medium">{targetProfile.playing}</span>
                    </p>
                  )}
                </div>
              )}
              {memberRoles.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--color-line)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-2">Cargos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {memberRoles.map((role) => (
                      <span key={role.id} className="chip !text-mv-text">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                        {role.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {!isSelf && <UserNoteField userId={targetProfile.id} />}
        </div>

        {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}

        {!isSelf && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              {!isBlocked && (
                <button onClick={handleMessage} disabled={loading} className="btn-primary h-9 px-4 text-sm flex-1 min-w-[9rem]">
                  Enviar mensagem
                </button>
              )}

              {isBlocked ? (
                <button onClick={() => handleAction(() => unblockUser(targetProfile.id))} disabled={loading} className={`${outlineBtn} flex-1`}>
                  Desbloquear
                </button>
              ) : friendship ? (
                <button onClick={() => handleAction(() => removeFriend(targetProfile.id))} disabled={loading} className={outlineBtn}>
                  Remover amigo
                </button>
              ) : incomingRequest ? (
                <>
                  <button
                    onClick={() => handleAction(() => acceptRequest(incomingRequest.id))}
                    disabled={loading}
                    className="h-9 px-4 text-sm font-semibold rounded-[10px] bg-mv-green text-white hover:brightness-110 transition disabled:opacity-60"
                  >
                    Aceitar
                  </button>
                  <button onClick={() => handleAction(() => declineRequest(incomingRequest.id))} disabled={loading} className={outlineBtn}>
                    Recusar
                  </button>
                </>
              ) : outgoingRequest ? (
                <button disabled className="h-9 px-4 text-sm rounded-[10px] bg-white/[0.04] text-mv-muted cursor-not-allowed">
                  Pedido enviado
                </button>
              ) : (
                <button
                  onClick={() => handleAction(() => sendRequest(targetProfile.username))}
                  disabled={loading}
                  className="h-9 px-4 text-sm font-medium rounded-[10px] border border-mv-accent/60 text-mv-accent hover:bg-mv-accent/10 transition-colors disabled:opacity-60"
                >
                  Adicionar amigo
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              {!isBlocked ? (
                <button
                  onClick={() => handleAction(() => blockUser(targetProfile.id))}
                  disabled={loading}
                  className="h-8 px-2.5 -ml-2.5 rounded-lg text-[13px] font-medium text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-60"
                >
                  Bloquear
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={() => setReporting(true)}
                disabled={loading}
                className="h-8 px-2.5 -mr-2.5 rounded-lg text-[13px] text-mv-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-60"
              >
                Denunciar usuário
              </button>
            </div>
          </div>
        )}
      </div>

      {reporting && (
        <ReportModal
          targetType="user"
          targetLabel={`@${targetProfile.username}`}
          reportedUserId={targetProfile.id}
          serverId={serverId}
          onClose={() => setReporting(false)}
        />
      )}
    </Modal>
  )
}

function UserNoteField({ userId }: { userId: string }) {
  const [note, setNote] = useState(() => getUserNote(userId))

  return (
    <div className="mt-3 pt-3 border-t border-[var(--color-line)]">
      <label htmlFor={`user-note-${userId}`} className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-1.5">
        Nota — visível apenas para você
      </label>
      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          setUserNote(userId, e.target.value)
        }}
        id={`user-note-${userId}`}
        placeholder="Escreva uma nota..."
        maxLength={256}
        rows={2}
        className="w-full px-3 py-2 text-[13px] bg-mv-canvas text-mv-text outline-none resize-none"
      />
    </div>
  )
}
