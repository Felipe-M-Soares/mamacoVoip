import { useState } from 'react'
import { useLinkPreview } from '../../hooks/useLinkPreview'
import {
  canEmbedTwitch,
  openOnSiteLabel,
  twitchClipEmbedUrl,
  youtubeEmbedUrl,
  youtubeThumb,
  type VideoLink,
} from '../../lib/videoEmbed'

// Vídeo do YouTube / clipe da Twitch tocando dentro do chat.
// Até a pessoa clicar no play aparece SÓ a miniatura — o player (e o
// YouTube/Twitch) só carrega depois do clique.

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7 translate-x-[1px]" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  )
}

export function VideoEmbedCard({ video }: { video: VideoLink }) {
  const [playing, setPlaying] = useState(false)
  const { data } = useLinkPreview(video.url)
  const title = data?.title ?? null
  const isYoutube = video.provider === 'youtube'
  const twitchOk = !isYoutube && canEmbedTwitch()
  const canPlayHere = isYoutube || twitchOk
  const vertical = isYoutube && video.shorts
  const thumb = isYoutube ? youtubeThumb(video.id) : (data?.image ?? null)
  const embedSrc = isYoutube
    ? youtubeEmbedUrl(video.id, video.start)
    : twitchClipEmbedUrl(video.slug, window.location.hostname)

  return (
    <div className={`mt-2 w-full ${vertical ? 'max-w-[280px]' : 'max-w-md'}`}>
      <div
        className={`relative overflow-hidden rounded-xl border border-[var(--color-line)] bg-black ${
          vertical ? 'aspect-[9/16]' : 'aspect-video'
        }`}
      >
        {playing && canPlayHere ? (
          <iframe
            src={embedSrc}
            title={title ?? (isYoutube ? 'Vídeo do YouTube' : 'Clipe da Twitch')}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
          />
        ) : (
          <button
            type="button"
            onClick={() => (canPlayHere ? setPlaying(true) : window.open(video.url, '_blank', 'noopener,noreferrer'))}
            className="group absolute inset-0 w-full h-full"
            title={canPlayHere ? 'Assistir aqui' : openOnSiteLabel(video)}
            aria-label={canPlayHere ? `Assistir ${title ?? 'vídeo'}` : openOnSiteLabel(video)}
          >
            {thumb ? (
              <img src={thumb} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className="absolute inset-0 bg-gradient-to-br from-purple-900/60 to-black" />
            )}
            <span className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
            <span
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-110 ${
                isYoutube ? 'bg-red-600' : 'bg-purple-600'
              }`}
            >
              <PlayIcon />
            </span>
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2 min-w-0">
        <span className="text-[12.5px] text-mv-muted truncate flex-1 min-w-0" title={title ?? undefined}>
          {title ?? (isYoutube ? 'YouTube' : 'Clipe da Twitch')}
        </span>
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[12px] font-medium text-mv-accent hover:underline"
          title={isYoutube ? 'Abre no YouTube (com o seu Premium, se tiver)' : 'Abre na Twitch'}
        >
          {openOnSiteLabel(video)} ↗
        </a>
      </div>
    </div>
  )
}
