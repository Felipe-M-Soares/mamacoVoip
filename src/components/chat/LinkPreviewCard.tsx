import { useLinkPreview } from '../../hooks/useLinkPreview'

const URL_REGEX = /https?:\/\/[^\s<]+/

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX)
  return match ? match[0] : null
}

export function LinkPreviewCard({ url }: { url: string }) {
  const { data } = useLinkPreview(url)

  if (!data || (!data.title && !data.description && !data.image)) return null

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-md rounded-lg overflow-hidden border border-white/10 bg-discord-darker hover:bg-discord-darker/70 transition-colors"
    >
      {data.image && (
        <img src={data.image} alt="" className="w-28 shrink-0 object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
      )}
      <div className="min-w-0 p-3">
        <p className="text-[10px] uppercase text-discord-text-muted truncate">{data.siteName}</p>
        {data.title && <p className="text-sm font-medium text-discord-blurple truncate">{data.title}</p>}
        {data.description && (
          <p className="text-xs text-discord-text-muted mt-0.5 line-clamp-2">{data.description}</p>
        )}
      </div>
    </a>
  )
}
