import { useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { callRpc } from '../lib/rpcCompat'

const cache = new Map<string, boolean>()

export function useIsAppAdmin(): boolean {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [isAdmin, setIsAdmin] = useState<boolean>(() => (userId ? cache.get(userId) ?? false : false))

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false)
      return
    }
    if (cache.has(userId)) {
      setIsAdmin(cache.get(userId)!)
      return
    }
    let cancelled = false
    callRpc<boolean>('is_app_admin').then(({ data, error, missing }) => {
      const value = !error && data === true
      if (!error || missing) cache.set(userId, value)
      if (!cancelled) setIsAdmin(value)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  return isAdmin
}
