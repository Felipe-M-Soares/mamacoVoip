import { useState } from 'react'
import { gameIconSource } from '../../lib/gameIcons'

export function GameIcon({
  game,
  playingApp,
  imageUrl,
  size = 16,
  className = '',
  title,
}: {
  game: string
  playingApp?: string | null
  imageUrl?: string | null
  size?: number
  className?: string
  title?: string
}) {
  const src = gameIconSource(game, playingApp)
  const urls = [...(imageUrl ? [imageUrl] : []), ...(src.kind === 'image' ? src.urls : [])]
  const key = `${game}|${playingApp ?? ''}|${imageUrl ?? ''}`
  const [failed, setFailed] = useState<{ key: string; n: number }>({ key, n: 0 })
  const n = failed.key === key ? failed.n : 0
  const label = title ?? `Jogando ${game}`
  const box = { width: size, height: size }

  if (n < urls.length) {
    return (
      <img
        src={urls[n]}
        alt={label}
        title={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed({ key, n: n + 1 })}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth < 8) setFailed({ key, n: n + 1 })
        }}
        style={box}
        className={`shrink-0 rounded-[4px] ${imageUrl && n === 0 ? 'object-contain' : 'object-cover'} ${className}`}
      />
    )
  }
  const fallback = gameIconSource(game, null)
  const letter = fallback.kind === 'letter' ? fallback.letter : (game.charAt(0) || '?').toUpperCase()
  const hue = fallback.kind === 'letter' ? fallback.hue : 0
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      style={{ ...box, fontSize: Math.max(8, Math.round(size * 0.6)), background: `hsl(${hue} 55% 38%)` }}
      className={`shrink-0 rounded-[4px] inline-flex items-center justify-center font-bold text-white leading-none ${className}`}
    >
      {letter}
    </span>
  )
}
