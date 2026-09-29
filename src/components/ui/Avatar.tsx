import { identityGradient } from '../../lib/identityColor'
import type { ProfileStatus } from '../../types/database'
import { useIsPresent } from '../../hooks/usePresence'

const STATUS_COLOR: Record<ProfileStatus, string> = {
  online: 'bg-discord-green',
  idle: 'bg-amber-400',
  dnd: 'bg-rose-500',
  offline: 'bg-zinc-500',
}

const STATUS_LABEL: Record<ProfileStatus, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
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
  // Moldura/anel decorativo (profile.avatar_decoration_url) — pode ser
  // uma imagem animada (GIF/WEBP). Só desenha em tamanhos grandes o
  // bastante pra fazer sentido (ver DECORATION_MIN_SIZE abaixo): numa
  // lista densa de 16-24px ela só viraria ruído visual em cima do
  // avatar, então nesses lugares o Avatar simplesmente ignora a prop.
  decorationUrl?: string | null
}

// Abaixo disso a decoração não é desenhada — ela é pensada pra ter uns
// 30% de "sangria" pra fora do avatar (ver estilo abaixo), o que fica
// ilegível/quebrado em ícones pequenos de lista (barra de canais,
// resultados de busca, etc.).
const DECORATION_MIN_SIZE = 32

export function Avatar({ name, avatarUrl, status, userId, size = 40, decorationUrl }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase()
  const isPresent = useIsPresent(userId)
  const effectiveStatus: ProfileStatus | undefined =
    status && status !== 'offline' && userId && !isPresent ? 'offline' : status
  // Espaço extra ao redor do avatar pra decoração "vazar" pra fora sem
  // ser cortada pelos elementos vizinhos (ver comentário acima) — só
  // existe quando tem decoração de verdade pra mostrar.
  const showDecoration = Boolean(decorationUrl) && size >= DECORATION_MIN_SIZE
  const pad = showDecoration ? size * 0.15 : 0

  return (
    <div
      className="relative shrink-0"
      style={{ width: size + pad * 2, height: size + pad * 2, margin: showDecoration ? -pad : 0 }}
    >
      <div className="absolute" style={{ top: pad, left: pad, width: size, height: size }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover bg-discord-lighter" />
        ) : (
          <div
            className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
            style={{ fontSize: size * 0.42, background: identityGradient(userId || name), textShadow: '0 1px 2px rgb(0 0 0 / 0.25)' }}
          >
            {initial}
          </div>
        )}
      </div>
      {showDecoration && (
        <img
          src={decorationUrl!}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
        />
      )}
      {effectiveStatus && (
        <span
          className={`absolute rounded-full transition-colors ${STATUS_COLOR[effectiveStatus]}`}
          title={STATUS_LABEL[effectiveStatus]}
          role="img"
          aria-label={STATUS_LABEL[effectiveStatus]}
          style={{
            width: Math.max(8, size * 0.3),
            height: Math.max(8, size * 0.3),
            bottom: pad,
            right: pad,
            boxShadow: `0 0 0 ${Math.max(2, Math.round(size * 0.07))}px var(--avatar-ring, var(--color-discord-sidebar))`,
          }}
        />
      )}
    </div>
  )
}
