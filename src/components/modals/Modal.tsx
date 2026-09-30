import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon as CloseGlyph } from '../ui/icons'

// Pilha de modais abertos (do mais antigo pro mais novo). Serve pra que
// Esc e o "prende o foco" só valham pro modal DO TOPO — um modal aberto
// por cima de outro (ex.: "Encaminhar mensagem" a partir de um modal de
// perfil) não pode fazer o Esc fechar os dois de uma vez.
const modalStack: symbol[] = []

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-md',
  description,
  footer,
  headerless = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: string
  /** Linha de apoio abaixo do título (opcional). */
  description?: ReactNode
  /** Rodapé fixo de ações — alinhado à direita (btn-secondary + btn-primary). */
  footer?: ReactNode
  /** Sem cabeçalho visível (ex.: perfil com banner no topo) — o título
   *  continua lá pro leitor de tela e o botão de fechar flutua no canto. */
  headerless?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // onClose costuma ser uma arrow function nova a cada render do pai —
  // guardado em ref pra não recriar os listeners (e nem perder o foco)
  // toda vez que o pai re-renderiza.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  // Só fecha pelo clique no fundo se o clique COMEÇOU no fundo — antes,
  // selecionar texto num input arrastando o mouse até fora do card
  // (mousedown dentro, mouseup fora) fechava o modal e perdia o que foi
  // digitado.
  const pointerDownOnBackdropRef = useRef(false)

  useEffect(() => {
    const token = Symbol('modal')
    modalStack.push(token)
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Foca o primeiro campo (ou o próprio diálogo) ao abrir — a não ser
    // que algum filho já tenha pego o foco sozinho (autoFocus).
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      const firstField = Array.from(
        dialog.querySelectorAll<HTMLElement>('input:not([disabled]):not([type="hidden"]):not([type="file"]), textarea:not([disabled]), select:not([disabled])')
      ).find((el) => el.offsetParent !== null)
      ;(firstField ?? dialog).focus({ preventScroll: true })
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (modalStack[modalStack.length - 1] !== token) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement
        )
        if (focusables.length === 0) {
          e.preventDefault()
          dialogRef.current.focus()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const idx = modalStack.indexOf(token)
      if (idx !== -1) modalStack.splice(idx, 1)
      // Devolve o foco pra quem abriu o modal (acessibilidade/teclado).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus?.({ preventScroll: true })
      }
    }
  }, [])

  return createPortal(
    // z-[500]: precisa ficar acima de QUALQUER painel fixo já aberto na tela
    // (ThreadPanel e PinnedMessagesPanel usam z-[300], o ScreenSharePicker e
    // o ServerWelcomeModal usam z-[400]) — senão um modal aberto por cima
    // desses painéis (ex.: "Encaminhar mensagem" a partir de uma thread)
    // renderiza atrás do painel, dando a impressão de estar quebrado.
    <div
      className="fixed inset-0 bg-black/70 animate-fade-in flex items-center justify-center z-[500] p-3 sm:p-4"
      onMouseDown={(e) => {
        pointerDownOnBackdropRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerDownOnBackdropRef.current) onClose()
        pointerDownOnBackdropRef.current = false
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`surface-elevated rounded-2xl animate-pop-in relative w-full ${maxWidth} max-h-[90vh] flex flex-col overflow-hidden outline-none`}
      >
        {headerless ? (
          <>
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 z-20 w-8 h-8 inline-flex items-center justify-center rounded-full bg-black/45 text-white/85 hover:bg-black/65 hover:text-white backdrop-blur transition-colors"
              aria-label="Fechar"
              title="Fechar (Esc)"
            >
              <CloseIcon />
            </button>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-1 shrink-0">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg font-semibold text-white leading-tight">
                {title}
              </h2>
              {description && <p className="text-[13px] text-mv-muted mt-1 leading-snug">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="icon-btn w-8 h-8 -mr-1.5 -mt-0.5 shrink-0"
              aria-label="Fechar"
              title="Fechar (Esc)"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        <div className={`flex-1 min-h-0 overflow-y-auto ${headerless ? '' : 'px-5 sm:px-6 pt-3 pb-5'}`}>{children}</div>
        {footer && (
          <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-5 sm:px-6 py-3.5 border-t border-[var(--color-line)] bg-black/[0.12]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function CloseIcon() {
  return (
    <CloseGlyph className="w-[18px] h-[18px]" aria-hidden />
  )
}
