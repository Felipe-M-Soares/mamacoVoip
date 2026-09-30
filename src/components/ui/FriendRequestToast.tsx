import { Avatar } from './Avatar'
import { useNewFriendRequests } from '../../hooks/useNewFriendRequests'
import { useFriends } from '../../context/FriendsContext'

export function FriendRequestToast() {
  const { newRequests, dismiss } = useNewFriendRequests()
  const { acceptRequest, declineRequest } = useFriends()

  if (newRequests.length === 0) return null

  return (
    <div className="fixed bottom-20 right-4 z-[270] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]" aria-live="polite">
      {newRequests.map((req) => (
        <div
          key={req.id}
          role="status"
          className="surface-elevated rounded-2xl p-4 animate-pop-in"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-2.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-mv-accent" aria-hidden="true" />
            Pedido de amizade
          </p>
          <div className="flex items-start gap-3">
            <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} size={40} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-sm font-semibold text-white truncate">
                {req.profile.display_name || req.profile.username}
              </p>
              <p className="text-xs text-mv-muted mt-0.5">quer ser seu amigo</p>
              {req.request_note && (
                <p className="text-xs text-mv-text mt-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-[var(--color-line)] italic line-clamp-2">"{req.request_note}"</p>
              )}
            </div>
            <button onClick={() => dismiss(req.id)} title="Dispensar" aria-label="Dispensar" className="icon-btn w-7 h-7 -mt-8 -mr-1.5 shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2 mt-3.5">
            <button
              onClick={async () => {
                await declineRequest(req.id)
                dismiss(req.id)
              }}
              className="flex-1 h-9 btn-secondary text-sm"
            >
              Recusar
            </button>
            <button
              onClick={async () => {
                await acceptRequest(req.id)
                dismiss(req.id)
              }}
              className="flex-1 h-9 rounded-[10px] bg-mv-green text-white text-sm font-semibold hover:brightness-110 active:scale-[0.99] transition"
            >
              Aceitar
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
