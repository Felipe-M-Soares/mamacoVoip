import { useLinkPreview } from '../../hooks/useLinkPreview'

const URL_REGEX = /https?:\/\/[^\s<]+/
const IMAGE_EXTENSION_REGEX = /\.(gif|png|jpe?g|webp|apng)(\?.*)?$/i

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX)
  return match ? match[0] : null
}

export function isDirectImageUrl(url: string): boolean {
  return IMAGE_EXTENSION_REGEX.test(url)
}

// Mensagem que é SÓ um link de imagem/GIF (nada mais digitado junto —
// é exatamente o que o seletor de GIF manda: `onSend(gifUrl, [])`, sem
// nenhum texto além do link). Nesse caso o link em si não deveria
// aparecer como texto normal, só a prévia da imagem embaixo — igual o
// Discord de verdade faz. Se a pessoa colar um link de imagem NO MEIO
// de uma frase, isso continua false e o texto aparece normal, com a
// prévia por baixo (mesmo comportamento de antes).
export function isPureMediaMessage(content: string): boolean {
  return isDirectImageUrl(content.trim())
}

export function LinkPreviewCard({ url }: { url: string }) {
  if (isDirectImageUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block max-w-sm">
        <img src={url} alt="" className="rounded-lg max-h-80 object-cover border border-black/20" />
      </a>
    )
  }
  return <LinkPreviewCardInner url={url} />
}

function LinkPreviewCardInner({ url }: { url: string }) {
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
