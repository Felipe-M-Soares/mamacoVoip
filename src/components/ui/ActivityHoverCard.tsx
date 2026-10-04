import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../types/database'

// Cartão que abre ao PASSAR O MOUSE na atividade de alguém ("Jogando X"):
// capa do jogo, há quanto tempo está jogando, botão pra loja (Steam) e
// uma resposta rápida por mensagem privada (emoji ou texto).

const QUICK_EMOJIS = ['✅', '🤣', '🇧🇷', '🤔', '❤️']

function steamIdOf(app: string | null | undefined): number | null {
  const m = /^steam:(\d+)$/.exec(app ?? '')
  return m ? Number(m[1]) : null
}

function elapsed(since: string | null | undefined, now: number): string | null {
  if (!since) return null
  const ms = now - new Date(since).getTime()
  if (!(ms > 0)) return null
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

function GameCover({ steamId, name }: { steamId: number | null; name: string }) {
  // Capa vertical da Steam → cabeçalho horizontal → ícone.
  const sources = steamId
    ? [
        `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`,
        `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`,
      ]
    : []
  const [i, setI] = useState(0)
  if (i >= sources.length) {
    return (
      <span className="w-[72px] h-[96px] rounded-lg bg-black/30 flex items-center justify-center shrink-0 text-3xl" aria-hidden>
        🎮
      </span>
    )
  }
  return (
    <img
      src={sources[i]}
      alt={`Capa de ${name}`}
      onError={() => setI((v) => v + 1)}
      className="w-[72px] h-[96px] rounded-lg object-cover shrink-0 bg-black/30 ring-1 ring-white/10"
    />
  )
}

export function ActivityHoverCard({ profile, children, className = '' }: { profile: Profile; children: ReactNode; className?: string }) {
  const { user } = useAuth()
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [text, setText] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const isSelf = profile.id === user?.id

  useEffect(() => {
    if (!open) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [open])

  if (!profile.playing) return <>{children}</>

  const cardW = 300
  function show() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    if (open) return
    openTimer.current = window.setTimeout(() => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const left = r.left > cardW + 16 ? r.left - cardW - 8 : Math.min(r.right + 8, window.innerWidth - cardW - 8)
      const top = Math.min(Math.max(8, r.top - 8), window.innerHeight - 330)
      setPos({ left, top })
      setNow(Date.now())
      setOpen(true)
    }, 350)
  }
  function hide() {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      setSent(null)
    }, 220)
  }

  async function send(content: string) {
    if (!user || !content.trim()) return
    const { data: conversation } = await supabase.rpc('get_or_create_dm', { p_other_user_id: profile.id })
    if (!conversation) {
      setSent('Não foi possível enviar.')
      return
    }
    const { error } = await supabase
      .from('dm_messages')
      .insert({ conversation_id: conversation.id, author_id: user.id, content: content.trim().slice(0, 2000) })
    setSent(error ? 'Não foi possível enviar.' : 'Mensagem enviada ✓')
    if (!error) setText('')
  }

  const steamId = steamIdOf(profile.playing_app)
  const store = steamId ? 'Steam' : profile.playing_app && !profile.playing_app.startsWith('steam:') ? profile.playing_app : null
  const time = elapsed(profile.playing_since, now)
  const name = profile.display_name || profile.username

  return (
    <div ref={anchorRef} className={className} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            role="dialog"
            aria-label={`${name} está jogando ${profile.playing}`}
            className="fixed z-[320] surface-elevated rounded-2xl p-3 animate-pop-in"
            style={{ left: pos.left, top: pos.top, width: cardW }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <p className="flex items-center gap-2 text-[13px] text-mv-text mb-2.5">
              <Avatar name={profile.username} avatarUrl={profile.avatar_url} size={20} />
              <span className="truncate">
                <strong className="font-semibold text-white">{name}</strong> está jogando
              </span>
            </p>
            <div
              className="rounded-xl p-3 flex gap-3"
              style={{
                background:
                  'linear-gradient(135deg, color-mix(in srgb, var(--color-mv-accent) 55%, #000), color-mix(in srgb, var(--color-mv-accent) 22%, #000))',
              }}
            >
              <GameCover steamId={steamId} name={profile.playing} />
              <div className="min-w-0 flex-1 flex flex-col">
                <p className="text-[15px] font-semibold text-white leading-snug line-clamp-3">{profile.playing}</p>
                <p className="text-[12px] text-white/75 mt-1 flex items-center gap-1.5">
                  <span aria-hidden>🎮</span>
                  {time ?? 'Jogando agora'}
                  {store && <span className="truncate">· {store}</span>}
                </p>
              </div>
            </div>
            {steamId && (
              <a
                href={`https://store.steampowered.com/app/${steamId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 h-9 w-full rounded-lg bg-white text-black text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-white/90 transition-colors"
              >
                Ver na Steam
              </a>
            )}
            {!isSelf && (
              <>
                <div className="flex items-center justify-between mt-3 px-1">
                  {QUICK_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => void send(e)}
                      title={`Mandar ${e} pra ${name}`}
                      className="w-9 h-9 rounded-lg text-[20px] hover:bg-white/[0.08] transition-colors"
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <form
                  className="mt-2"
                  onSubmit={(ev) => {
                    ev.preventDefault()
                    void send(text)
                  }}
                >
                  <input
                    value={text}
                    onChange={(ev) => setText(ev.target.value)}
                    maxLength={2000}
                    placeholder={`Conversar com @${profile.username}`}
                    aria-label={`Mensagem para ${name}`}
                    className="w-full h-10 px-3 bg-mv-canvas text-mv-text text-[13px] outline-none"
                  />
                </form>
                {sent && <p className="text-[11.5px] text-mv-muted mt-1.5 px-1">{sent}</p>}
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
