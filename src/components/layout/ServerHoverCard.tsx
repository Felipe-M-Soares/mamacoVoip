import { createPortal } from 'react-dom'
import { Avatar } from '../ui/Avatar'
import { useServerMembers } from '../../hooks/useServerMembers'
import { useOnlineIds } from '../../hooks/usePresence'
import type { Server } from '../../types/database'

// Card que aparece ao passar o mouse por cima de um servidor na barra
// lateral — mostra rapidinho quem está online ali dentro, sem precisar
// abrir o servidor (igual o tooltip de servidor do Discord). Só é
// montado enquanto o mouse está em cima do ícone (ver ServerBar.tsx),
// então `useServerMembers` busca os membros na hora — sem precisar
// manter esses dados carregados o tempo todo pra servidores que a
// pessoa nem está olhando.
export function ServerHoverCard({ server, anchorRect }: { server: Server; anchorRect: DOMRect }) {
  const { members, loading } = useServerMembers(server.id)
  const onlineIds = useOnlineIds()
  // Mesmo critério de "online de verdade" usado em MemberList.tsx e
  // FriendsPanel.tsx: status diferente de offline E presença em tempo
  // real confirmada.
  const onlineMembers = members.filter((m) => m.profile.status !== 'offline' && onlineIds.has(m.profile.id))

  // Alinha verticalmente com o ícone e aparece logo à direita da barra
  // lateral (72px de largura) — clampado pra não vazar pra fora da tela
  // em telas menores ou quando o servidor está perto do fim da lista.
  const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - 260))
  const left = anchorRect.right + 12

  return createPortal(
    <div
      style={{ position: 'fixed', top, left }}
      // pointer-events-none: é só uma prévia, não precisa ser clicável
      // — e assim o mouse "atravessa" o card sem disparar um
      // mouseleave falso no ícone por causa de sobreposição.
      className="z-[190] w-64 surface-elevated rounded-xl p-3.5 pointer-events-none animate-pop-in"
    >
      <p className="font-display text-sm font-semibold text-white truncate">{server.name}</p>
      <div className="flex items-center gap-1.5 mt-1 mb-2.5 text-xs text-discord-text-muted">
        {loading ? (
          <span className="h-2.5 w-16 rounded-full bg-white/[0.06] animate-pulse" />
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-discord-green" aria-hidden="true" />
            {onlineMembers.length} online
          </>
        )}
      </div>
      {!loading && onlineMembers.length === 0 && (
        <p className="text-xs text-discord-text-muted px-2.5 py-2 rounded-lg bg-white/[0.03] border border-[var(--color-line)]">Ninguém online agora.</p>
      )}
      <div className="space-y-1.5 max-h-52 overflow-hidden">
        {onlineMembers.slice(0, 12).map((m) => (
          <div key={m.user_id} className="flex items-center gap-2">
            <Avatar
              name={m.profile.username}
              avatarUrl={m.profile.avatar_url}
              status={m.profile.status}
              userId={m.profile.id}
              size={22}
            />
            <span className="text-[13px] text-discord-text truncate">
              {m.profile.display_name || m.profile.username}
            </span>
          </div>
        ))}
        {onlineMembers.length > 12 && (
          <p className="text-[10px] text-discord-text-muted pt-0.5">+{onlineMembers.length - 12} outros</p>
        )}
      </div>
    </div>,
    document.body
  )
}
