import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { ContextMenu, useContextMenuState } from '../ui/ContextMenu'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { useFriends } from '../../context/FriendsContext'
import { ManageMemberModal } from '../modals/ManageMemberModal'
import { InviteFriendsModal } from '../modals/InviteFriendsModal'
import type { Profile, Role } from '../../types/database'

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

  const others = members.filter((m) => m.profile.id !== profile?.id)
  const online = others.filter((m) => m.profile.status !== 'offline')
  const offline = others.filter((m) => m.profile.status === 'offline')

  // Agrupa quem está online pelo cargo mais alto de cada um — igual
  // ao Discord, com o nome e a cor do cargo como título do grupo.
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
        className="group w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5"
        onContextMenu={(e) => {
          setContextProfile(member.profile)
          openMenu(e)
        }}
      >
        <button onClick={() => onViewProfile(member.profile)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <Avatar name={member.profile.username} avatarUrl={member.profile.avatar_url} status={member.profile.status} size={32} />
          <div className="min-w-0">
            <span
              className={`text-sm truncate block ${topRole ? '' : 'text-discord-text'}`}
              style={topRole ? { color: topRole.color } : undefined}
            >
              {member.profile.display_name || member.profile.username}
            </span>
            {member.profile.playing && (
              <span className="text-[10px] text-discord-text-muted truncate block">
                🎮 {member.profile.playing}
              </span>
            )}
          </div>
        </button>
        {canModerate && (
          <button
            onClick={() => setManagingProfile(member.profile)}
            title="Gerenciar membro"
            className="hidden group-hover:block text-discord-text-muted hover:text-white shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1c.5.4 1.1.8 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
            </svg>
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
        className={`w-60 bg-discord-sidebar shrink-0 overflow-y-auto py-4 px-2 lg:block lg:static ${
          mobileOpen ? 'fixed inset-y-0 right-0 z-40 block' : 'hidden'
        }`}
      >
        <div className="lg:hidden flex justify-end mb-2">
          <button onClick={onCloseMobile} className="text-discord-text-muted hover:text-white p-1">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>
      {loading ? (
        <div className="flex justify-center pt-8">
          <div className="w-5 h-5 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {profile && (
            <div>
              <h3 className="px-2 text-xs font-bold text-discord-text-muted tracking-wider mb-1.5">VOCÊ</h3>
              <button
                onClick={() => onViewProfile(profile)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded hover:bg-white/5 text-left"
              >
                <Avatar name={profile.username} avatarUrl={profile.avatar_url} status={profile.status} size={32} />
                <span className="text-sm text-discord-text truncate">
                  {profile.display_name || profile.username}
                </span>
              </button>
            </div>
          )}

          {groupedOnline.map(({ role, members: group }) => (
            <div key={role?.id ?? 'no-role'}>
              <h3
                className="px-2 text-xs font-bold tracking-wider mt-4 mb-1.5"
                style={{ color: role?.color ?? undefined }}
              >
                <span className={role ? '' : 'text-discord-text-muted'}>
                  {(role?.name ?? 'ONLINE').toUpperCase()} — {group.length}
                </span>
              </h3>
              {group.map((m) => (
                <MemberRow key={m.user_id} member={m} />
              ))}
            </div>
          ))}

          <h3 className="px-2 text-xs font-bold text-discord-text-muted tracking-wider mt-4 mb-1.5">
            OFFLINE — {offline.length}
          </h3>
          {offline.map((m) => (
            <div key={m.user_id} className="opacity-50">
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
                      onClick: () => navigator.clipboard.writeText(`@${contextProfile.username}`),
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
                onClick: () => navigator.clipboard.writeText(contextProfile.username),
              },
              { label: 'Copiar ID do usuário', onClick: () => navigator.clipboard.writeText(contextProfile.id) },
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
