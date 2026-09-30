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
  online: 'bg-mv-green',
  idle: 'bg-amber-400',
  dnd: 'bg-rose-500',
  offline: 'bg-zinc-500',
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
// um app de chat popular mostra um cartão de perfil persistente ali. Substitui a
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
    <aside aria-label="Perfil" className="hidden xl:flex w-72 shrink-0 bg-mv-side flex-col overflow-y-auto border-t border-l border-[var(--color-line)]">
      <div className="p-3 pb-0">
      <div
        className="h-28 shrink-0 bg-cover bg-center rounded-xl"
        style={
          profile.banner_url
            ? { backgroundImage: `url(${profile.banner_url})` }
            : { background: gradientFor(profile.username) }
        }
      />
      </div>
      <div className="px-4 pb-4 -mt-10">
        <div className="inline-block rounded-full ring-[6px] ring-mv-side ml-2">
        <Avatar
          name={profile.username}
          avatarUrl={profile.avatar_url}
          decorationUrl={profile.avatar_decoration_url}
          status={profile.status}
          userId={profile.id}
          size={80}
        />
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-[var(--color-line)] p-3.5 mt-3">
        <h3 className="font-display text-lg font-semibold text-white truncate">
          {profile.display_name || profile.username}
        </h3>
        <p className="text-sm text-mv-muted truncate">@{profile.username}</p>

        <div className="chip mt-3">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[isEffectivelyOnline ? profile.status : 'offline']}`} />
          {STATUS_LABEL[isEffectivelyOnline ? profile.status : 'offline']}
        </div>

        {(profile.custom_status || (profile.playing && isEffectivelyOnline)) && <div className="h-px bg-[var(--color-line)] my-3" />}
        {profile.custom_status && <p className="text-sm text-mv-text break-words">{profile.custom_status}</p>}
        {profile.playing && isEffectivelyOnline && (
          <div className="mt-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-1.5">Atividade</p>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-lg bg-mv-green/15 text-mv-green flex items-center justify-center shrink-0" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M7 6h10a5 5 0 0 1 4.9 6l-.8 4a3 3 0 0 1-5.2 1.4L14.2 16H9.8l-1.7 1.4A3 3 0 0 1 2.9 16l-.8-4A5 5 0 0 1 7 6zm0 3v1.5H5.5v1.5H7v1.5h1.5V12H10v-1.5H8.5V9H7zm8.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
                </svg>
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-xs text-mv-muted">Jogando</span>
                <span className="block text-sm font-semibold text-white truncate">{profile.playing}</span>
              </span>
            </div>
          </div>
        )}
        </div>

        <button
          onClick={onViewFullProfile}
          className="w-full h-10 mt-3 btn-secondary text-sm font-medium"
        >
          {isSelf ? 'Editar perfil' : 'Ver perfil completo'}
        </button>
      </div>
    </aside>
  )
}
