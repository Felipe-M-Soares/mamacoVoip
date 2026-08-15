import type { ProfileStatus } from '../../types/database'

const STATUS_COLOR: Record<ProfileStatus, string> = {
  online: 'bg-discord-green',
  idle: 'bg-yellow-500',
  dnd: 'bg-red-500',
  offline: 'bg-gray-500',
}

interface AvatarProps {
  name: string
  avatarUrl?: string | null
  status?: ProfileStatus
  size?: number
}

export function Avatar({ name, avatarUrl, status, size = 40 }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase()

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full rounded-full object-cover" />
      ) : (
        <div
          className="w-full h-full rounded-full bg-discord-blurple flex items-center justify-center text-white font-medium"
          style={{ fontSize: size * 0.4 }}
        >
          {initial}
        </div>
      )}
      {status && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-[3px] border-discord-sidebar ${STATUS_COLOR[status]}`}
          style={{ width: size * 0.32, height: size * 0.32 }}
        />
      )}
    </div>
  )
}
