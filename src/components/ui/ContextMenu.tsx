import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  divider?: boolean // se true, desenha uma linha ANTES deste item
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: y, left: x, visibility: 'hidden' as 'hidden' | 'visible' })

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Depois do primeiro render, ajusta a posição pra não vazar pra fora
  // da tela (ex: clicou perto da borda direita/inferior)
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    let top = y
    let left = x
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8
    setPosition({ top, left: Math.max(8, left), visibility: 'visible' })
  }, [x, y])

  // Foca o primeiro item ao abrir — permite navegar com as setas logo de
  // cara (e o leitor de tela anuncia o menu).
  useEffect(() => {
    const node = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = node?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
    first?.focus({ preventScroll: true })
    // Devolve o foco pra onde estava (ex.: o campo de mensagem) ao fechar —
    // mas só se ele ainda estiver "perdido" no menu (ou no body): se a ação
    // escolhida já focou outra coisa (ex.: caixa de edição), não rouba.
    return () => {
      const active = document.activeElement
      const focusLost = !active || active === document.body || (node?.contains(active) ?? false)
      if (focusLost && previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
        previouslyFocused.focus?.({ preventScroll: true })
      }
    }
  }, [])

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length
    else if (e.key === 'ArrowUp') next = idx <= 0 ? items.length - 1 : idx - 1
    else if (e.key === 'End') next = items.length - 1
    items[next].focus()
  }

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: position.top, left: position.left, visibility: position.visibility }}
      role="menu"
      onKeyDown={handleMenuKeyDown}
      className="z-[200] min-w-[208px] max-w-[280px] surface-elevated rounded-xl animate-pop-in p-1.5 outline-none"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && <div role="separator" className="h-px bg-[var(--color-line)] my-1.5 mx-1.5" />}
          <button
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            disabled={item.disabled}
            role="menuitem"
            className={`group w-full flex items-center gap-2.5 text-left px-2.5 py-[7px] rounded-lg text-[14px] font-medium outline-none transition-colors ${
              item.danger
                ? 'text-rose-400 hover:bg-rose-500/12 focus-visible:bg-rose-500/12'
                : 'text-mv-text hover:bg-mv-accent hover:text-white focus-visible:bg-mv-accent focus-visible:text-white'
            } ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {item.icon && (
              <span
                aria-hidden="true"
                className={`w-4 h-4 shrink-0 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4 ${
                  item.danger ? '' : 'text-mv-muted group-hover:text-white group-focus-visible:text-white'
                }`}
              >
                {item.icon}
              </span>
            )}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}

// Hook auxiliar: gerencia a posição/estado aberto-fechado do menu.
// Usa-se com onContextMenu={openMenu} num elemento, e renderiza
// {menuState && <ContextMenu x={menuState.x} y={menuState.y} items={...} onClose={closeMenu} />}
export function useContextMenuState() {
  const [state, setState] = useState<{ x: number; y: number } | null>(null)

  function openMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setState({ x: e.clientX, y: e.clientY })
  }

  function closeMenu() {
    setState(null)
  }

  return { menuState: state, openMenu, closeMenu }
}
