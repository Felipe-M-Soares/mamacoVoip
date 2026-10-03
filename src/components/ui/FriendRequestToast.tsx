import { Avatar } from './Avatar'
import { useNewFriendRequests } from '../../hooks/useNewFriendRequests'
import { useFriends } from '../../context/FriendsContext'
import { useOverlayOpen } from '../../hooks/useOverlayOpen'

// Aviso de pedido de amizade novo.
//  - Sai da frente quando tem algo aberto por cima (modal, tour, menu
//    lateral do celular) e volta quando fecha.
//  - No celular vira uma faixa compacta no topo (antes era um cartão
//    grande no meio da tela, em cima do chat, do menu e do tour), e só
//    mostra o pedido mais novo (+N se tiver mais).
export function FriendRequestToast() {
  const { newRequests, dismiss } = useNewFriendRequests()
  const { acceptRequest, declineRequest } = useFriends()
  const overlayOpen = useOverlayOpen()

  if (newRequests.length === 0 || overlayOpen) return null

  const latest = newRequests[newRequests.length - 1]

  async function accept(id: string) {
    await acceptRequest(id)
    dismiss(id)
  }
  async function decline(id: string) {
    await declineRequest(id)
    dismiss(id)
  }

  return (
    <>
      {/* Celular: faixa compacta no topo, só o mais novo. */}
      <div className="sm:hidden fixed top-[60px] left-2 right-2 z-[270]" aria-live="polite">
        <div role="status" className="surface-elevated rounded-xl px-3 py-2 flex items-center gap-2.5 animate-pop-in">
          <Avatar name={latest.profile.username} avatarUrl={latest.profile.avatar_url} size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[13px] font-semibold text-white truncate">
              {latest.profile.display_name || latest.profile.username}
            </p>
            <p className="text-[11.5px] text-mv-muted truncate">
              quer ser seu amigo{newRequests.length > 1 ? ` · +${newRequests.length - 1}` : ''}
            </p>
          </div>
          <button
            onClick={() => void decline(latest.id)}
            aria-label="Recusar pedido"
            title="Recusar"
            className="w-9 h-9 rounded-full bg-white/[0.06] text-mv-muted flex items-center justify-center shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="w-4 h-4" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <button
            onClick={() => void accept(latest.id)}
            aria-label="Aceitar pedido"
            title="Aceitar"
            className="w-9 h-9 rounded-full bg-mv-green text-white flex items-center justify-center shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
          <button
            onClick={() => dismiss(latest.id)}
            aria-label="Dispensar"
            title="Dispensar"
            className="w-6 h-6 -mr-1 text-mv-muted flex items-center justify-center shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Computador: cartões no canto. */}
      <div className="max-sm:hidden fixed bottom-20 right-4 z-[270] flex flex-col gap-2 w-80" aria-live="polite">
        {newRequests.map((req) => (
          <div key={req.id} role="status" className="surface-elevated rounded-2xl p-4 animate-pop-in">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-2.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-mv-accent" aria-hidden="true" />
              Pedido de amizade
            </p>
            <div className="flex items-start gap-3">
              <Avatar name={req.profile.username} avatarUrl={req.profile.avatar_url} size={40} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-sm font-semibold text-white truncate">{req.profile.display_name || req.profile.username}</p>
                <p className="text-xs text-mv-muted mt-0.5">quer ser seu amigo</p>
                {req.request_note && (
                  <p className="text-xs text-mv-text mt-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-[var(--color-line)] italic line-clamp-2">
                    "{req.request_note}"
                  </p>
                )}
              </div>
              <button onClick={() => dismiss(req.id)} title="Dispensar" aria-label="Dispensar" className="icon-btn w-7 h-7 -mt-8 -mr-1.5 shrink-0">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
                </svg>
              </button>
            </div>
            <div className="flex gap-2 mt-3.5">
              <button onClick={() => void decline(req.id)} className="flex-1 h-9 btn-secondary text-sm">
                Recusar
              </button>
              <button
                onClick={() => void accept(req.id)}
                className="flex-1 h-9 rounded-[10px] bg-mv-green text-white text-sm font-semibold hover:brightness-110 active:scale-[0.99] transition"
              >
                Aceitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
