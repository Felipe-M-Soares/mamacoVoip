import { Avatar } from './Avatar'
import { useNewFriendRequests } from '../../hooks/useNewFriendRequests'
import { useFriends } from '../../context/FriendsContext'

export function FriendRequestToast() {
  const { newRequests, dismiss } = useNewFriendRequests()
  const { acceptRequest, declineRequest } = useFriends()

  if (newRequests.length === 0) return null

  return (
    <div className="fixed bottom-20 right-4 z-[270] flex flex-col gap-2 w-80">
      {newRequests.map((req) => (
        <div
          key={req.id}
          className="bg-discord-dark border border-discord-blurple/30 rounded-xl shadow-2xl p-3.5 brand-glow-sm"
        >
          <div className="flex items-start gap-3">
            <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">
                {req.profile.display_name || req.profile.username} quer ser seu amigo
              </p>
              {req.request_note && (
                <p className="text-xs text-discord-text-muted mt-0.5 italic truncate">"{req.request_note}"</p>
              )}
            </div>
            <button onClick={() => dismiss(req.id)} title="Dispensar" className="text-discord-text-muted hover:text-white shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={async () => {
                await declineRequest(req.id)
                dismiss(req.id)
              }}
              className="flex-1 py-1.5 rounded btn-secondary text-xs"
            >
              Recusar
            </button>
            <button
              onClick={async () => {
                await acceptRequest(req.id)
                dismiss(req.id)
              }}
              className="flex-1 py-1.5 rounded bg-discord-green text-white text-xs font-medium hover:brightness-110"
            >
              Aceitar
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
