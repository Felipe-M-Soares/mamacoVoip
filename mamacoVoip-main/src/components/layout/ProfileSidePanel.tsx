import { Avatar } from '../ui/Avatar'
import { useIsPresent } from '../../hooks/usePresence'
import type { Profile, ProfileStatus } from '../../types/database'

const STATUS_LABEL: Record<ProfileStatus, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
}
const STATUS_DOT: Record<ProfileStatus, string> = {
  online: 'bg-discord-green',
  idle: 'bg-yellow-500',
  dnd: 'bg-red-500',
  offline: 'bg-gray-500',
}

// Mesmo truque de gradiente-por-nome de ServerBar.tsx (ServerIcon) — o
// "banner" do card fica com uma cor diferente por pessoa, em vez de
// todo mundo com o mesmo fundo genérico.
function gradientFor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue} 70% 40%), hsl(${(hue + 45) % 360} 65% 22%))`
}

// Painel fixo do lado direito da tela inicial (Amigos/DM/Grupo) — igual
// o Discord mostra um cartão de perfil persistente ali. Substitui a
// antiga barra de ping isolada em cima do UserPanel (ver
// UserPanel.tsx/task #9): a MESMA ideia de "mostrar informação sobre
// alguém" agora vira um card de verdade, com avatar grande e ação de
// ver o perfil completo, em vez de só um número de latência solto.
//
// Mostra o perfil de QUEM FAZ SENTIDO pra tela atual: a própria pessoa
// na tela de Amigos/Grupos, ou quem está do outro lado quando é uma
// conversa direta — ver a lógica de qual profile passar em
// MainLayout.tsx.
export function ProfileSidePanel({
  profile,
  isSelf,
  onViewFullProfile,
}: {
  profile: Profile
  isSelf: boolean
  onViewFullProfile: () => void
}) {
  const isPresent = useIsPresent(profile.id)
  // Perfil próprio: sempre "efetivamente online" do jeito que a pessoa
  // escolheu (ela sabe o próprio status). Perfil de outra pessoa: só
  // conta como online se a presença em tempo real confirmar (mesmo
  // critério usado em Avatar.tsx/MemberList.tsx).
  const isEffectivelyOnline = profile.status !== 'offline' && (isSelf || isPresent)

  return (
    <aside className="hidden xl:flex w-72 shrink-0 bg-discord-sidebar flex-col overflow-y-auto">
      <div
        className="h-40 shrink-0 bg-cover bg-center"
        style={
          profile.banner_url
            ? { backgroundImage: `url(${profile.banner_url})` }
            : { background: gradientFor(profile.username) }
        }
      />
      <div className="px-4 pb-4 -mt-10">
        <Avatar
          name={profile.username}
          avatarUrl={profile.avatar_url}
          decorationUrl={profile.avatar_decoration_url}
          status={profile.status}
          userId={profile.id}
          size={80}
        />
        <h3 className="text-lg font-bold text-white mt-3 truncate">
          {profile.display_name || profile.username}
        </h3>
        <p className="text-sm text-discord-text-muted truncate">@{profile.username}</p>

        <div className="flex items-center gap-1.5 mt-2">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[isEffectivelyOnline ? profile.status : 'offline']}`} />
          <span className="text-xs text-discord-text-muted">
            {STATUS_LABEL[isEffectivelyOnline ? profile.status : 'offline']}
          </span>
        </div>

        {profile.playing && isEffectivelyOnline && (
          <p className="text-sm text-discord-text mt-3 flex items-center gap-1.5">
            <span>🎮</span>
            <span className="truncate">Jogando {profile.playing}</span>
          </p>
        )}
        {profile.custom_status && <p className="text-sm text-discord-text mt-2 break-words">{profile.custom_status}</p>}

        <div className="h-px bg-white/10 my-4" />

        <button
          onClick={onViewFullProfile}
          className="w-full py-2.5 rounded btn-secondary text-sm font-medium"
        >
          {isSelf ? 'Editar perfil' : 'Ver perfil completo'}
        </button>
      </div>
    </aside>
  )
}
