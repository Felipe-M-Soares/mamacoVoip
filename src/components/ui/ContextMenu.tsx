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
    setPosition({ top, left, visibility: 'visible' })
  }, [x, y])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: position.top, left: position.left, visibility: position.visibility }}
      className="z-[200] min-w-[190px] bg-[#111214] rounded-md shadow-xl border border-black/40 py-1.5"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && <div className="h-px bg-white/10 my-1.5" />}
          <button
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2.5 text-left px-3 py-2 text-sm transition-colors ${
              item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-discord-text hover:bg-white/5'
            } ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {item.icon}
            {item.label}
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
