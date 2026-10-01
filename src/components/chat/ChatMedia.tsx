import { openMedia } from '../../lib/mediaViewer'

// Imagem/vídeo de anexo no chat: clicar abre o visualizador DENTRO do app
// (lib/mediaViewer), em vez de uma aba do navegador.
export function ChatImage({ url, name, onError }: { url: string | undefined; name?: string; onError?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => url && openMedia({ src: url, kind: 'image', name })}
      title="Clique para ampliar"
      className="block text-left rounded-xl focus-visible:outline-2 focus-visible:outline-mv-accent cursor-zoom-in"
    >
      <img
        src={url}
        onError={onError}
        alt={name ?? ''}
        className="rounded-xl max-h-80 object-cover border border-[var(--color-line)] hover:brightness-110 transition"
      />
    </button>
  )
}

export function ChatVideo({ url, name, onError }: { url: string | undefined; name?: string; onError?: () => void }) {
  return (
    <div className="relative group/video w-fit max-w-full">
      <video
        controls
        preload="metadata"
        src={url}
        onError={onError}
        className="rounded-xl max-h-80 max-w-full border border-[var(--color-line)] bg-black"
      />
      <button
        type="button"
        onClick={() => url && openMedia({ src: url, kind: 'video', name })}
        title="Ampliar vídeo"
        aria-label="Ampliar vídeo"
        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/video:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden>
          <path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm16 0h-2v4h-4v2h6v-6z" />
        </svg>
      </button>
    </div>
  )
}
