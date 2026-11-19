import type { ReactNode } from 'react'
import { useAttachmentUrl } from '../../hooks/useAttachmentUrl'

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
  if (unavailable) {
    return (
      <span className="inline-flex w-fit items-center rounded-xl border border-[var(--color-line)] bg-mv-canvas px-3 py-2 text-xs italic text-mv-muted">
        Anexo indisponível
      </span>
    )
  }
  return <>{children(url ?? undefined, onError)}</>
}
