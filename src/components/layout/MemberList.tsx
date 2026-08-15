import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useModeration } from '../../hooks/useModeration'
import { useRoles } from '../../hooks/useRoles'
import { ManageMemberModal } from '../modals/ManageMemberModal'
import type { Profile } from '../../types/database'

export function MemberList({ serverId, onViewProfile }: { serverId: string; onViewProfile: (profile: Profile) => void }) {
  const { profile } = useAuth()
  const { members, loading, refresh } = useServerMembers(serverId)
  const { permissions } = useModeration(serverId)
  const { rolesForUser } = useRoles(serverId)
  const [managingProfile, setManagingProfile] = useState<Profile | null>(null)

  const canModerate = permissions.kick_members || permissions.ban_members || permissions.timeout_members || permissions.manage_roles

  const others = members.filter((m) => m.profile.id !== profile?.id)
  const online = others.filter((m) => m.profile.status !== 'offline')
  const offline = others.filter((m) => m.profile.status === 'offline')

  function MemberRow({ member }: { member: (typeof members)[number] }) {
    const topRole = rolesForUser(member.profile.id)[0]
    return (
      <div className="group w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5">
        <button onClick={() => onViewProfile(member.profile)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <Avatar name={member.profile.username} avatarUrl={member.profile.avatar_url} status={member.profile.status} size={32} />
          <div className="min-w-0">
            <span className="text-sm truncate block" style={topRole ? { color: topRole.color } : { color: '#dcddde' }}>
              {member.profile.display_name || member.profile.username}
            </span>
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
    <aside className="w-60 bg-discord-sidebar shrink-0 overflow-y-auto py-4 px-2 hidden lg:block">
      {loading ? (
        <div className="flex justify-center pt-8">
          <div className="w-5 h-5 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {profile && (
            <div>
              <h3 className="px-2 text-xs font-semibold text-discord-text-muted mb-1">VOCÊ</h3>
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

          <h3 className="px-2 text-xs font-semibold text-discord-text-muted mt-4 mb-1">
            ONLINE — {online.length}
          </h3>
          {online.map((m) => (
            <MemberRow key={m.user_id} member={m} />
          ))}

          <h3 className="px-2 text-xs font-semibold text-discord-text-muted mt-4 mb-1">
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
    </aside>
  )
}
