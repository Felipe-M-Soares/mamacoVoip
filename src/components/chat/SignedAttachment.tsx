import type { ReactNode } from 'react'
import { useAttachmentUrl } from '../../hooks/useAttachmentUrl'

// Casca fina em volta de useAttachmentUrl pra usar dentro de um .map()
// (hook não pode ser chamado em loop). `children` recebe a URL pronta
// (assinada, ou undefined enquanto carrega/sem acesso) e o onError pra
// pendurar no <img>/<audio>/<video>. URL de outro host vira o aviso
// "Anexo indisponível" (não é carregada).
export function SignedAttachment({
  bucket,
  fileUrl,
  autoRenew,
  children,
}: {
  bucket: string
  fileUrl: string
  autoRenew?: boolean
  children: (url: string | undefined, onError: () => void) => ReactNode
}) {
  const { url, onError, unavailable } = useAttachmentUrl(bucket, fileUrl, { autoRenew })
  // Anexo apontando pra fora do nosso Storage (outro host): não busca o
  // arquivo — evita que quem inseriu a linha pela API rastreie o IP de
  // quem abriu a conversa.
  if (unavailable) {
    return (
      <span className="inline-flex w-fit items-center rounded-xl border border-[var(--color-line)] bg-mv-canvas px-3 py-2 text-xs italic text-mv-muted">
        Anexo indisponível
      </span>
    )
  }
  return <>{children(url ?? undefined, onError)}</>
}
