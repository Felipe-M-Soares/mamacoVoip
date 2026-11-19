const KEY = 'mamacos-show-playing'
const EVENT = 'mamacos:show-playing-changed'

export function getShowPlaying(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setShowPlaying(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '0')
  } catch {
  }
  window.electronAPI?.setGameDetectionEnabled?.(enabled).catch(() => {
  })
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function subscribeShowPlaying(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) callback()
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}
