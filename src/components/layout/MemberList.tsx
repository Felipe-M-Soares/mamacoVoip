import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { useFriends } from '../../context/FriendsContext'
import { useOnlineIds } from '../../hooks/usePresence'
import type { Profile, Role } from '../../types/database'
import { lazyModal } from '../modals/lazyModal'
import { CloseIcon, GamepadIcon, SettingsIcon } from '../ui/icons'
import { copyText } from '../../lib/copyText'
import { useVoiceRoster } from '../../lib/voiceRoster'
import { useChannels } from '../../hooks/useChannels'

// Modais/painéis carregados só quando abertos (fora do pacote inicial).
const ManageMemberModal = lazyModal(() => import('../modals/ManageMemberModal').then((m) => m.ManageMemberModal))
const InviteFriendsModal = lazyModal(() => import('../modals/InviteFriendsModal').then((m) => m.InviteFriendsModal))

export function MemberList({
  serverId,
  onViewProfile,
  onMessageUser,
  mobileOpen = false,
  desktopOpen = false,
  onCloseMobile,
}: {
  serverId: string
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
  mobileOpen?: boolean
  /** No computador a lista fica escondida até clicar no botão "Membros" */
  desktopOpen?: boolean
  onCloseMobile?: () => void
}) {
  const { profile } = useAuth()
  const { members, loading, refresh } = useServerMembers(serverId)
  const { permissions } = useModeration(serverId)
  const { rolesForUser, roles } = useRoles(serverId)
  const { sendRequest, friends } = useFriends()
  const [managingProfile, setManagingProfile] = useState<Profile | null>(null)
  const [contextProfile, setContextProfile] = useState<Profile | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const { menuState, openMenu, closeMenu } = useContextMenuState()

  const canModerate = permissions.kick_members || permissions.ban_members || permissions.timeout_members || permissions.manage_roles

  const onlineIds = useOnlineIds()
  // "Online" de verdade exige as duas coisas: a pessoa não escolheu
  // aparecer offline/invisível E o socket dela está mesmo conectado agora
  // (ver usePresence.ts) — sem isso, quem fechou o app de qualquer jeito
  // continuava listado aqui em cima pra sempre.
  const isEffectivelyOnline = (p: Profile) => p.status !== 'offline' && onlineIds.has(p.id)
  const roster = useVoiceRoster()
  const { channels } = useChannels()
  const voiceChannelName = (userId: string) => {
    const channelId = roster.get(userId)
    return channelId ? (channels.find((c) => c.id === channelId)?.name ?? 'sala de voz') : null
  }
  // Você entra na contagem como online (mesmo invisível pra você mesmo ver).
  const isShownOnline = (p: Profile) => p.id === profile?.id || isEffectivelyOnline(p)
  const online = members.filter((m) => isShownOnline(m.profile))
  const offline = members.filter((m) => !isShownOnline(m.profile))

  // Agrupa quem está online pelo cargo mais alto de cada um, com o nome e
  // a cor do cargo como título. Sem cargo → "Disponível".
  const groupedOnline: { role: Role | null; members: typeof online }[] = []
  for (const role of [...roles].sort((a, b) => b.position - a.position)) {
    const inRole = online.filter((m) => rolesForUser(m.profile.id)[0]?.id === role.id)
    if (inRole.length > 0) groupedOnline.push({ role, members: inRole })
  }
  const noRole = online.filter((m) => !rolesForUser(m.profile.id)[0])
  if (noRole.length > 0) groupedOnline.push({ role: null, members: noRole })

  // "Atividade": quem está jogando agora.
  const activity = online.filter((m) => m.profile.playing)

  function MemberRow({ member }: { member: (typeof members)[number] }) {
    const p = member.profile
    const topRole = rolesForUser(p.id)[0]
    const isMe = p.id === profile?.id
    const online = isShownOnline(p)
    const inVoice = online ? voiceChannelName(p.id) : null
    return (
      <div
        className="group relative w-full flex items-center gap-2 px-2 py-[6px] rounded-lg overflow-hidden hover:bg-white/[0.05] transition-colors"
        onContextMenu={(e) => {
          setContextProfile(p)
          openMenu(e)
        }}
      >
        {/* Banner do perfil como fundo do cartão (quando a pessoa tem). */}
        {p.banner_url && online && (
          <>
            <img src={p.banner_url} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-70 pointer-events-none" />
            <span
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(90deg, var(--color-mv-side) 25%, color-mix(in srgb, var(--color-mv-side) 55%, transparent) 70%, transparent)' }}
            />
          </>
        )}
        <button onClick={() => onViewProfile(p)} className="relative flex items-center gap-2.5 flex-1 min-w-0 text-left rounded-md">
          <Avatar
            name={p.username}
            avatarUrl={p.avatar_url}
            decorationUrl={p.avatar_decoration_url}
            status={p.status}
            userId={p.id}
            size={32}
          />
          <div className="min-w-0 leading-tight">
            <span
              className={`text-[14px] font-medium truncate block ${topRole ? '' : 'text-mv-text'}`}
              style={topRole ? { color: topRole.color } : undefined}
            >
              {p.display_name || p.username}
              {isMe && <span className="text-mv-muted font-normal"> (você)</span>}
            </span>
            {inVoice ? (
              <span className="text-[11px] text-mv-green truncate flex items-center gap-1 mt-0.5">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 shrink-0" aria-hidden>
                  <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 15 8.2v7.6a4.5 4.5 0 0 0 1.5-3.8z" />
                </svg>
                <span className="truncate">Em voz · {inVoice}</span>
              </span>
            ) : p.playing && online ? (
              <span className="text-[11px] text-mv-muted truncate flex items-center gap-1 mt-0.5">
                <GamepadIcon className="w-3 h-3 shrink-0 text-mv-green" aria-hidden />
                <span className="truncate">
                  Jogando <strong className="font-semibold text-mv-text/90">{p.playing}</strong>
                </span>
              </span>
            ) : p.custom_status && online ? (
              <span className="text-[11px] text-mv-muted truncate block mt-0.5">{p.custom_status}</span>
            ) : null}
          </div>
        </button>
        {canModerate && !isMe && (
          <button
            onClick={() => setManagingProfile(p)}
            title="Gerenciar membro"
            aria-label="Gerenciar membro"
            className="relative icon-btn w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <SettingsIcon className="w-4 h-4" aria-hidden />
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {mobileOpen && (
        <div data-overlay-open className="lg:hidden fixed inset-0 bg-black/60 z-40" onClick={onCloseMobile} />
      )}
      <aside
        aria-label="Membros"
        className={`w-64 bg-mv-side shrink-0 overflow-y-auto py-4 px-2.5 ${desktopOpen ? 'lg:block lg:static' : 'lg:!hidden'} border-t border-l border-[var(--color-line)] ${
          mobileOpen ? 'fixed inset-y-0 right-0 z-40 block animate-fade-slide-in shadow-[-24px_0_60px_-12px_rgb(0_0_0/0.6)]' : 'hidden'
        }`}
      >
        <div className="lg:hidden flex items-center justify-between mb-2 px-2">
          <span className="font-display font-semibold text-white">Membros</span>
          <button onClick={onCloseMobile} aria-label="Fechar membros" title="Fechar" className="icon-btn w-9 h-9">
            <CloseIcon className="w-5 h-5" aria-hidden />
          </button>
        </div>
      {loading ? (
        <div className="space-y-1 pt-1" role="status" aria-label="Carregando membros">
          <div className="h-2.5 w-20 rounded-full bg-white/[0.06] mx-2 mb-3 animate-pulse" />
          {[62, 48, 70, 55, 40, 66].map((w, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-[6px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="w-8 h-8 rounded-full bg-white/[0.06] shrink-0" />
              <div className="h-2.5 rounded-full bg-white/[0.05]" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {activity.length > 0 && (
            <div className="mb-4">
              <h3 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-1.5">
                Atividade <span className="text-mv-muted/70">— {activity.length}</span>
              </h3>
              <div className="space-y-1.5">
                {activity.slice(0, 6).map((m) => {
                  const topRole = rolesForUser(m.profile.id)[0]
                  return (
                    <button
                      key={m.user_id}
                      onClick={() => onViewProfile(m.profile)}
                      className="w-full text-left rounded-xl bg-white/[0.035] border border-[var(--color-line)] hover:bg-white/[0.06] px-2.5 py-2 flex items-center gap-2.5 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[12px] truncate">
                          <Avatar name={m.profile.username} avatarUrl={m.profile.avatar_url} size={16} />
                          <span className="truncate font-medium" style={topRole ? { color: topRole.color } : undefined}>
                            {m.profile.display_name || m.profile.username}
                          </span>
                        </p>
                        <p className="text-[13px] font-semibold text-white truncate mt-0.5">{m.profile.playing}</p>
                        <p className="text-[11px] text-mv-muted flex items-center gap-1 mt-0.5">
                          <GamepadIcon className="w-3 h-3 text-mv-green" aria-hidden /> Jogando agora
                        </p>
                      </div>
                      <span className="w-10 h-10 rounded-lg bg-mv-accent/15 text-mv-accent ring-1 ring-inset ring-mv-accent/25 flex items-center justify-center shrink-0">
                        <GamepadIcon className="w-5 h-5" aria-hidden />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {groupedOnline.map(({ role, members: group }) => (
            <div key={role?.id ?? 'no-role'}>
              <h3 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mt-4 first:mt-0 mb-1.5 flex items-center gap-1.5">
                {role && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: role.color }} aria-hidden="true" />}
                <span className="truncate">{role?.name ?? 'Disponível'}</span>
                <span className="text-mv-muted/70">— {group.length}</span>
              </h3>
              {group.map((m) => (
                <MemberRow key={m.user_id} member={m} />
              ))}
            </div>
          ))}

          <h3 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mt-5 mb-1.5">
            Offline <span className="text-mv-muted/70">— {offline.length}</span>
          </h3>
          {offline.map((m) => (
            <div key={m.user_id} className="opacity-45 hover:opacity-100 transition-opacity">
              <MemberRow member={m} />
            </div>
          ))}
        </>
      )}

        {managingProfile && (
          <ManageMemberModal
            serverId={serverId}
            targetProfile={managingProfile}
            onClose={() => setManagingProfile(null)}
            onKicked={refresh}
          />
        )}

        {menuState && contextProfile && (
          <ContextMenu
            x={menuState.x}
            y={menuState.y}
            onClose={closeMenu}
            items={[
              { label: 'Ver perfil', onClick: () => onViewProfile(contextProfile) },
              ...(contextProfile.id !== profile?.id
                ? [
                    { label: 'Mensagem', onClick: () => onMessageUser?.(contextProfile.id) },
                    {
                      label: 'Mencionar (copiar @)',
                      onClick: () => copyText(`@${contextProfile.username}`),
                    },
                    ...(!friends.some((f) => f.profile.id === contextProfile.id)
                      ? [
                          {
                            label: 'Adicionar amigo',
                            onClick: async () => {
                              const { error } = await sendRequest(contextProfile.username)
                              if (error) alert(error)
                            },
                          },
                        ]
                      : []),
                    { label: 'Convidar para o servidor', onClick: () => setShowInvite(true) },
                  ]
                : []),
              {
                label: 'Copiar nome de usuário',
                onClick: () => copyText(contextProfile.username),
              },
              { label: 'Copiar ID do usuário', onClick: () => copyText(contextProfile.id) },
              ...(canModerate && contextProfile.id !== profile?.id
                ? [
                    {
                      label: 'Gerenciar membro',
                      divider: true,
                      onClick: () => setManagingProfile(contextProfile),
                    },
                  ]
                : []),
            ]}
          />
        )}

        {showInvite && <InviteFriendsModal serverId={serverId} onClose={() => setShowInvite(false)} />}
      </aside>
    </>
  )
}
