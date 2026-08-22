import type { ProfileStatus } from '../../types/database'
import { useIsPresent } from '../../hooks/usePresence'

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
  // Id do dono do avatar — opcional (nem todo lugar que usa Avatar tem um
  // usuário por trás, ex.: preview de convite). Quando presente, cruza o
  // `status` escolhido no perfil com a presença em tempo real (ver
  // usePresence/PresenceContext): se a pessoa não estiver de fato
  // conectada agora, mostra offline mesmo que o banco ainda diga
  // "online" (caso de quem fechou o app sem dar logout).
  userId?: string | null
  size?: number
}

export function Avatar({ name, avatarUrl, status, userId, size = 40 }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase()
  const isPresent = useIsPresent(userId)
  const effectiveStatus: ProfileStatus | undefined =
    status && status !== 'offline' && userId && !isPresent ? 'offline' : status

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
      {effectiveStatus && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-[3px] border-discord-sidebar ${STATUS_COLOR[effectiveStatus]}`}
          style={{ width: size * 0.32, height: size * 0.32 }}
        />
      )}
    </div>
  )
}
