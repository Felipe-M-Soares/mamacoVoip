import { useCallback, useState } from 'react'
import { getPinnedSet, togglePinned } from '../lib/pinnedItems'

export function usePinnedItems() {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => getPinnedSet())

  const toggle = useCallback((id: string) => {
    togglePinned(id)
    setPinnedIds(getPinnedSet())
  }, [])

  return { pinnedIds, toggle }
}
