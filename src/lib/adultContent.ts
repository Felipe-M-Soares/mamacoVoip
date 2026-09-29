// Preferências LOCAIS de conteúdo adulto (+18), no modelo do Discord:
// conteúdo adulto só aparece em canais marcados como +18 (channels.is_nsfw)
// e só pra quem confirmou ser maior de idade.
//
// A confirmação "oficial" fica no perfil (profiles.age_verified_adult_at,
// migration 015) e acompanha a conta em qualquer aparelho. Aqui guardamos:
//   * showAdult — "Mostrar conteúdo +18 em canais com restrição de idade".
//     Desligado = o portão aparece TODA vez que a pessoa abre um canal +18
//     (a confirmação vale só pra aquela visita).
//   * localConfirmedUserId — cópia local da confirmação (por conta), pra o
//     portão não piscar enquanto o perfil carrega e pra funcionar num banco
//     que ainda não rodou a 015. Revogar apaga as duas.

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
    // Armazenamento bloqueado (janela anônima etc.) — segue só em memória.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/** Padrão: ligado (quem já confirmou a idade não precisa confirmar de novo). */
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

/**
 * O portão de idade precisa aparecer? Função pura (testável):
 *  - canal comum → nunca;
 *  - revelado nesta visita → não;
 *  - confirmado + "mostrar conteúdo +18" ligado → não;
 *  - qualquer outro caso → sim.
 */
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

/** Rating da GIPHY: "r" é o máximo que a API oferece; o resto do app usa "pg-13". */
export function giphyRating(adult: boolean): 'r' | 'pg-13' {
  return adult ? 'r' : 'pg-13'
}

// Ao sair da conta, a confirmação local não pode valer pra próxima pessoa.
if (typeof window !== 'undefined') {
  window.addEventListener('mamacos:signed-out', () => setLocallyConfirmedAdult(null))
}
