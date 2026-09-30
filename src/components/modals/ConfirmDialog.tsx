import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'

// Substitui o confirm()/alert() nativo do navegador (que trava a janela,
// ignora o tema e no app desktop aparece com o título "Electron") por um
// diálogo do próprio app, usando o Modal base (foco preso, Esc, etc.).
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
  alertOnly = false,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  /** Só um botão de "OK" (equivalente ao alert()). */
  alertOnly?: boolean
}) {
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      maxWidth="max-w-sm"
      footer={
        <>
          {!alertOnly && (
            <button type="button" onClick={onCancel} className="btn-secondary h-9 px-4 text-sm">
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            autoFocus
            className={`${danger ? 'btn-danger' : 'btn-primary'} h-9 px-4 text-sm`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
            danger ? 'bg-rose-500/12 text-rose-400' : 'bg-mv-accent/15 text-mv-accent'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
            {danger ? (
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            ) : (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8h.01M11 12h1v4h1" />
              </>
            )}
          </svg>
        </span>
        <div className="text-[14px] text-mv-muted leading-relaxed pt-1.5">{message}</div>
      </div>
    </Modal>
  )
}
