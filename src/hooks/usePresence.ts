import { useContext } from 'react'
import { PresenceContext } from '../context/PresenceContext'

export function useIsPresent(userId: string | null | undefined): boolean {
  const { onlineIds } = useContext(PresenceContext)
  if (!userId) return false
  return onlineIds.has(userId)
}

export function useOnlineIds(): Set<string> {
  return useContext(PresenceContext).onlineIds
}
