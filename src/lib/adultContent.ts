const SHOW_KEY = 'mamacos:adult-content:show'
const CONFIRMED_KEY = 'mamacos:adult-content:confirmed-user'
const EVENT = 'mamacos:adult-content-changed'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function getShowAdultContent(): boolean {
  return read(SHOW_KEY) !== '0'
}

export function setShowAdultContent(show: boolean) {
  write(SHOW_KEY, show ? '1' : '0')
}

export function isLocallyConfirmedAdult(userId: string | undefined | null): boolean {
  return !!userId && read(CONFIRMED_KEY) === userId
}

export function setLocallyConfirmedAdult(userId: string | null) {
  write(CONFIRMED_KEY, userId)
}

export function subscribeAdultContent(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === SHOW_KEY || e.key === CONFIRMED_KEY) callback()
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

export function shouldGateAdultChannel(opts: {
  isNsfw: boolean
  verified: boolean
  showAdult: boolean
  revealedThisVisit: boolean
}): boolean {
  if (!opts.isNsfw) return false
  if (opts.revealedThisVisit) return false
  return !(opts.verified && opts.showAdult)
}

if (typeof window !== 'undefined') {
  window.addEventListener('mamacos:signed-out', () => setLocallyConfirmedAdult(null))
}
