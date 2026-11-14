import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useConversations } from '../../hooks/useConversations'
import { useGroupConversations } from '../../context/GroupConversationsContext'
import { useFriends } from '../../context/FriendsContext'
import { useOverlayOpen } from '../../hooks/useOverlayOpen'
import { supabase } from '../../lib/supabase'
import { describeMessageContent } from '../../lib/stickers'
import { playDmSound } from '../../lib/sounds'
import { showMessageNotification } from '../../lib/notifications'
import { isNativeMobileApp } from '../../lib/platform'
import { decideAlert, isAppFocused, onIncomingMessage, previewText, type IncomingMessage } from '../../lib/messageAlerts'

// Aviso de mensagem privada (DM/grupo) chegando — ver lib/messageAlerts.ts.
// Montado uma vez no MainLayout.

type Toast = {
  key: string
  kind: 'dm' | 'group'
  targetId: string
  title: string
  subtitle?: string
  body: string
  avatarName: string
  avatarUrl: string | null
  count: number
}

const TOAST_MS = 6000
const MAX_TOASTS = 3

type ProfileLite = { id: string; username: string; display_name: string | null; avatar_url: string | null }
const profileCache = new Map<string, ProfileLite>()

async function fetchProfile(id: string): Promise<ProfileLite | null> {
  const cached = profileCache.get(id)
  if (cached) return cached
  const { data } = await supabase.from('profiles').select('id, username, display_name, avatar_url').eq('id', id).maybeSingle()
  if (data) profileCache.set(id, data as ProfileLite)
  return (data as ProfileLite | null) ?? null
}

export function MessageAlerts({
  viewingTargetId,
  onUnread,
}: {
  /** conversa/grupo aberto na tela agora (null = nenhum) */
  viewingTargetId: string | null
  /** marca a conversa/grupo como não lido na hora (bolinha + contador) */
  onUnread: (kind: 'dm' | 'group', id: string) => void
}) {
  const { user } = useAuth()
  const { conversations } = useConversations()
  const { groups } = useGroupConversations()
  const { blocked } = useFriends()
  const overlayOpen = useOverlayOpen()
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const blockedIds = useMemo(() => new Set(blocked.map((b) => b.blocked_id)), [blocked])

  // Tudo que o ouvinte precisa, sempre atualizado, sem reinscrever.
  const ctx = useRef({ userId: user?.id ?? null, viewingTargetId, conversations, groups, blockedIds, onUnread })
  ctx.current = { userId: user?.id ?? null, viewingTargetId, conversations, groups, blockedIds, onUnread }

  function dismiss(key: string) {
    const t = timers.current.get(key)
    if (t) clearTimeout(t)
    timers.current.delete(key)
    setToasts((prev) => prev.filter((x) => x.key !== key))
  }

  function scheduleDismiss(key: string) {
    const old = timers.current.get(key)
    if (old) clearTimeout(old)
    timers.current.set(
      key,
      setTimeout(() => dismiss(key), TOAST_MS)
    )
  }

  function open(kind: 'dm' | 'group', id: string, key?: string) {
    if (key) dismiss(key)
    window.dispatchEvent(new CustomEvent('mv:open-target', { detail: { kind, id } }))
  }

  useEffect(() => {
    async function handle(m: IncomingMessage) {
      const c = ctx.current
      const appFocused = isAppFocused()
      const mode = decideAlert({
        message: m,
        myId: c.userId,
        viewingTargetId: c.viewingTargetId,
        appFocused,
        blockedIds: c.blockedIds,
      })
      if (mode === 'none') return
      c.onUnread(m.kind, m.targetId)

      // Celular em segundo plano: quem avisa é a notificação push (com o
      // som do Android) — não toca nada aqui pra não dobrar.
      if (mode === 'system' && isNativeMobileApp()) return
      playDmSound()

      // Quem mandou / onde
      let authorName = 'Alguém'
      let avatarUrl: string | null = null
      let title: string
      let subtitle: string | undefined
      if (m.kind === 'dm') {
        const convo = c.conversations.find((x) => x.id === m.targetId)
        const p = convo?.otherProfile ?? (await fetchProfile(m.authorId))
        if (p) {
          authorName = p.display_name || p.username
          avatarUrl = p.avatar_url
        }
        title = authorName
      } else {
        const g = c.groups.find((x) => x.id === m.targetId)
        const p = g?.members.find((x) => x.id === m.authorId) ?? (await fetchProfile(m.authorId))
        if (p) {
          authorName = p.display_name || p.username
          avatarUrl = p.avatar_url
        }
        const groupName =
          g?.name ||
          g?.members
            .filter((x) => x.id !== c.userId)
            .map((x) => x.display_name || x.username)
            .join(', ') ||
          'Grupo'
        title = authorName
        subtitle = groupName
      }
      const body = previewText(describeMessageContent(m.content ?? ''))

      if (mode === 'system') {
        showMessageNotification(subtitle ? `${title} em ${subtitle}` : title, body, { kind: m.kind, id: m.targetId }, avatarUrl)
        return
      }

      // Aviso no canto: várias mensagens da mesma conversa viram um aviso só.
      const key = `${m.kind}:${m.targetId}`
      setToasts((prev) => {
        const existing = prev.find((t) => t.key === key)
        const next: Toast = {
          key,
          kind: m.kind,
          targetId: m.targetId,
          title,
          subtitle,
          body,
          avatarName: authorName,
          avatarUrl,
          count: (existing?.count ?? 0) + 1,
        }
        const rest = prev.filter((t) => t.key !== key)
        return [next, ...rest].slice(0, MAX_TOASTS)
      })
      scheduleDismiss(key)
    }
    const off = onIncomingMessage((m) => void handle(m))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Abriu a conversa por outro caminho → some o aviso dela.
  useEffect(() => {
    if (!viewingTargetId) return
    setToasts((prev) => (prev.some((t) => t.targetId === viewingTargetId) ? prev.filter((t) => t.targetId !== viewingTargetId) : prev))
  }, [viewingTargetId])

  // Clique na notificação do Windows (app de PC).
  useEffect(() => {
    const off = window.electronAPI?.onNotificationClick?.((target) => {
      if (target?.id) window.dispatchEvent(new CustomEvent('mv:open-target', { detail: target }))
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  if (toasts.length === 0 || overlayOpen) return null

  return (
    <div
      className="fixed z-[275] flex flex-col gap-2 w-[22rem] max-w-[calc(100vw-2rem)] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] sm:left-auto sm:translate-x-0 sm:top-auto sm:right-5 sm:bottom-5"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.key}
          role="status"
          onMouseEnter={() => {
            const timer = timers.current.get(t.key)
            if (timer) clearTimeout(timer)
          }}
          onMouseLeave={() => scheduleDismiss(t.key)}
          className="surface-elevated rounded-2xl animate-pop-in flex items-center gap-3 p-3 pr-2 border-l-2 border-mv-accent/80"
        >
          <button
            onClick={() => open(t.kind, t.targetId, t.key)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
            title="Abrir conversa"
          >
            <Avatar name={t.avatarName} avatarUrl={t.avatarUrl} size={36} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13px] text-white font-semibold truncate">
                {t.title}
                {t.subtitle && <span className="font-normal text-mv-muted"> em {t.subtitle}</span>}
                {t.count > 1 && (
                  <span className="ml-1.5 align-middle text-[10px] font-bold bg-mv-accent text-white rounded-full px-1.5 py-px">
                    {t.count}
                  </span>
                )}
              </p>
              <p className="text-[12.5px] text-mv-text truncate mt-0.5">{t.body}</p>
            </div>
          </button>
          <button onClick={() => dismiss(t.key)} title="Fechar aviso" aria-label="Fechar aviso" className="icon-btn w-7 h-7 shrink-0">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
              <path d="M6.4 19a1 1 0 0 1-.7-1.7L10.6 12 5.7 7.1a1 1 0 0 1 1.4-1.4L12 10.6l4.9-4.9a1 1 0 0 1 1.4 1.4L13.4 12l4.9 4.9a1 1 0 0 1-1.4 1.4L12 13.4l-4.9 4.9a1 1 0 0 1-.7.3z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
