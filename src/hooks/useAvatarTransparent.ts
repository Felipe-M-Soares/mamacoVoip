import { useSyncExternalStore } from 'react'
import { getCachedTransparency, subscribeTransparency } from '../lib/imageTransparency'

export function useAvatarTransparent(url: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeTransparency,
    () => (url ? getCachedTransparency(url) === true : false),
    () => false
  )
}
