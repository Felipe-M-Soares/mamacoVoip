import { useCallback, useState } from 'react'

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
    const missing = allIds.filter((id) => !next.includes(id))
    setOrder([...next, ...missing])
  }

  return { order, setOrder, sortByOrder, moveServer }
}
