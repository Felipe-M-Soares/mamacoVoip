import { useState } from 'react'
import { detectTransparency, getCachedTransparency, mayHaveTransparency } from '../../lib/imageTransparency'
import { identityGradient } from '../../lib/identityColor'
import type { ProfileStatus } from '../../types/database'
import { useIsPresent } from '../../hooks/usePresence'

const STATUS_COLOR: Record<ProfileStatus, string> = {
  online: 'bg-mv-green',
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
  userId?: string | null
  size?: number
  decorationUrl?: string | null
}

const DECORATION_MIN_SIZE = 32

export function Avatar({ name, avatarUrl, status, userId, size = 40, decorationUrl }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase()
  const isPresent = useIsPresent(userId)
  const effectiveStatus: ProfileStatus | undefined =
    status && status !== 'offline' && userId && !isPresent ? 'offline' : status
  const showDecoration = Boolean(decorationUrl) && size >= DECORATION_MIN_SIZE
  const pad = showDecoration ? size * 0.15 : 0

  return (
    <div
      className="relative shrink-0"
      style={{ width: size + pad * 2, height: size + pad * 2, margin: showDecoration ? -pad : 0 }}
    >
      <div className="absolute" style={{ top: pad, left: pad, width: size, height: size }}>
        {avatarUrl ? (
          <AvatarImage key={avatarUrl} url={avatarUrl} name={name} />
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
            boxShadow: `0 0 0 ${Math.max(2, Math.round(size * 0.07))}px var(--avatar-ring, var(--color-mv-side))`,
          }}
        />
      )}
    </div>
  )
}

function canInspectPixels(url: string): boolean {
  if (url.startsWith('blob:') || url.startsWith('data:')) return true
  try {
    return new URL(url).hostname.endsWith('.supabase.co') && mayHaveTransparency(url)
  } catch {
    return false
  }
}

function AvatarImage({ url, name }: { url: string; name: string }) {
  const inspect = canInspectPixels(url)
  const [transparent, setTransparent] = useState(() => (inspect ? getCachedTransparency(url) ?? false : false))
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      decoding="async"
      crossOrigin={inspect ? 'anonymous' : undefined}
      onLoad={inspect ? (e) => setTransparent(detectTransparency(e.currentTarget)) : undefined}
      className={`w-full h-full ${transparent ? 'object-contain' : 'rounded-full object-cover bg-mv-raised'}`}
    />
  )
}
