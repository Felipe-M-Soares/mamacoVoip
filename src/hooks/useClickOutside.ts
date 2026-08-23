import { useEffect, useRef } from 'react'

// Antes, esses menus (mic, fone, mais opções, volume...) fechavam no
// onMouseLeave do próprio wrapper. O problema: entre o botãozinho da seta
// e o painel que abre, sempre tem uma folga (a margem "mb-2" pra separar
// visualmente). Quando o mouse atravessa essa folga pra chegar no painel,
// ele sai da área do wrapper por um instante — o que já disparava o
// onMouseLeave e fechava o menu ANTES do cursor alcançar as opções lá
// dentro. Esse hook troca isso por "fecha só se eu clicar fora": o menu
// fica aberto o tempo que for preciso pra mover o mouse até ele, e só
// some quando o usuário realmente clica em outro lugar (ou aperta Esc).
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return

    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onOutside()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [active, onOutside])

  return ref
}
