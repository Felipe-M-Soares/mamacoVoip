import { useCallback, useState } from 'react'

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function writeSet(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(value)))
  } catch {
    // best-effort
  }
}

// Categorias recolhidas/expandidas — guardado globalmente (o id da
// categoria já é único), então a preferência vale em qualquer servidor.
export function useCollapsedCategories() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readSet('mamacos-collapsed-categories'))

  function toggle(categoryId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      writeSet('mamacos-collapsed-categories', next)
      return next
    })
  }

  return { collapsed, toggle }
}

// Ordem customizada dos servidores na barra lateral — arrastar pra
// reorganizar. Guardado só neste navegador (não sincroniza entre
// dispositivos), mas evita precisar de uma coluna nova no banco só
// pra uma preferência de interface.
export function useServerOrder() {
  const [order, setOrderState] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('mamacos-server-order')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const setOrder = useCallback((ids: string[]) => {
    setOrderState(ids)
    try {
      localStorage.setItem('mamacos-server-order', JSON.stringify(ids))
    } catch {
      // best-effort
    }
  }, [])

  const sortByOrder = useCallback(
    <T extends { id: string }>(items: T[]): T[] => {
      if (order.length === 0) return items
      const indexOf = (id: string) => {
        const idx = order.indexOf(id)
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
      }
      return [...items].sort((a, b) => indexOf(a.id) - indexOf(b.id))
    },
    [order]
  )

  function moveServer(draggedId: string, beforeId: string, allIds: string[]) {
    const current = order.length > 0 ? order : allIds
    const withoutDragged = current.filter((id) => id !== draggedId)
    const insertIndex = withoutDragged.indexOf(beforeId)
    const next =
      insertIndex === -1
        ? [...withoutDragged, draggedId]
        : [...withoutDragged.slice(0, insertIndex), draggedId, ...withoutDragged.slice(insertIndex)]
    // garante que todo servidor atual apareça na lista, mesmo que tenha
    // sido criado depois da última vez que a ordem foi salva
    const missing = allIds.filter((id) => !next.includes(id))
    setOrder([...next, ...missing])
  }

  return { order, setOrder, sortByOrder, moveServer }
}
