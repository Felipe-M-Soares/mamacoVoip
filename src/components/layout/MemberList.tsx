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

// Modais/painéis carregados só quando abertos (fora do pacote inicial).
const ManageMemberModal = lazyModal(() => import('../modals/ManageMemberModal').then((m) => m.ManageMemberModal))
const InviteFriendsModal = lazyModal(() => import('../modals/InviteFriendsModal').then((m) => m.InviteFriendsModal))

export function MemberList({
  serverId,
  onViewProfile,
  onMessageUser,
  mobileOpen = false,
  onCloseMobile,
}: {
  serverId: string
  onViewProfile: (profile: Profile) => void
  onMessageUser?: (userId: string) => void
  mobileOpen?: boolean
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
  const others = members.filter((m) => m.profile.id !== profile?.id)
  const online = others.filter((m) => isEffectivelyOnline(m.profile))
  const offline = others.filter((m) => !isEffectivelyOnline(m.profile))

  // Agrupa quem está online pelo cargo mais alto de cada um — igual
  // a apps de chat populares, com o nome e a cor do cargo como título do grupo.
  // Quem não tem nenhum cargo cai num grupo "ONLINE" genérico no final.
  const groupedOnline: { role: Role | null; members: typeof online }[] = []
  for (const role of roles) {
    const inRole = online.filter((m) => rolesForUser(m.profile.id)[0]?.id === role.id)
    if (inRole.length > 0) groupedOnline.push({ role, members: inRole })
  }
  const noRole = online.filter((m) => !rolesForUser(m.profile.id)[0])
  if (noRole.length > 0 || groupedOnline.length === 0) groupedOnline.push({ role: null, members: noRole })

  function MemberRow({ member }: { member: (typeof members)[number] }) {
    const topRole = rolesForUser(member.profile.id)[0]
    return (
      <div
        className="group w-full flex items-center gap-2 px-2 py-[6px] rounded-lg hover:bg-white/[0.05] transition-colors"
        onContextMenu={(e) => {
          setContextProfile(member.profile)
          openMenu(e)
        }}
      >
        <button onClick={() => onViewProfile(member.profile)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left rounded-md">
          <Avatar
            name={member.profile.username}
            avatarUrl={member.profile.avatar_url}
            decorationUrl={member.profile.avatar_decoration_url}
            status={member.profile.status}
            userId={member.profile.id}
            size={32}
          />
          <div className="min-w-0 leading-tight">
            <span
              className={`text-[14px] font-medium truncate block ${topRole ? '' : 'text-mv-text'}`}
              style={topRole ? { color: topRole.color } : undefined}
            >
              {member.profile.display_name || member.profile.username}
            </span>
            {member.profile.playing && isEffectivelyOnline(member.profile) ? (
              <span className="text-[11px] text-mv-muted truncate flex items-center gap-1 mt-0.5">
                <GamepadIcon className="w-3 h-3 shrink-0 text-mv-green" aria-hidden />
                <span className="truncate">
                  Jogando <strong className="font-semibold text-mv-text/90">{member.profile.playing}</strong>
                </span>
              </span>
            ) : member.profile.custom_status && isEffectivelyOnline(member.profile) ? (
              <span className="text-[11px] text-mv-muted truncate block mt-0.5">{member.profile.custom_status}</span>
            ) : null}
          </div>
        </button>
        {canModerate && (
          <button
            onClick={() => setManagingProfile(member.profile)}
            title="Gerenciar membro"
            aria-label="Gerenciar membro"
            className="icon-btn w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
        <div className="lg:hidden fixed inset-0 bg-black/60 z-40" onClick={onCloseMobile} />
      )}
      <aside
        aria-label="Membros"
        className={`w-60 bg-mv-side shrink-0 overflow-y-auto py-4 px-2.5 lg:block lg:static border-t border-l border-[var(--color-line)] ${
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
          {profile && (
            <div>
              <h3 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-1.5">Você</h3>
              <button
                onClick={() => onViewProfile(profile)}
                className="w-full flex items-center gap-2.5 px-2 py-[6px] rounded-lg hover:bg-white/[0.05] transition-colors text-left"
              >
                <Avatar
                  name={profile.username}
                  avatarUrl={profile.avatar_url}
                  decorationUrl={profile.avatar_decoration_url}
                  status={profile.status}
                  userId={profile.id}
                  size={32}
                />
                <span className="min-w-0 leading-tight">
                  <span className="text-[14px] font-medium text-mv-text truncate block">
                    {profile.display_name || profile.username}
                  </span>
                  {profile.custom_status && (
                    <span className="text-[11px] text-mv-muted truncate block mt-0.5">{profile.custom_status}</span>
                  )}
                </span>
              </button>
            </div>
          )}

          {groupedOnline.map(({ role, members: group }) => (
            <div key={role?.id ?? 'no-role'}>
              <h3 className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mt-5 mb-1.5 flex items-center gap-1.5">
                {role && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: role.color }} aria-hidden="true" />}
                <span className="truncate">{role?.name ?? 'Online'}</span>
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
