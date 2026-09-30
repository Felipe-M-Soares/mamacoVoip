// Preferência de privacidade "Mostrar o jogo que estou jogando"
// (Configurações → Privacidade). Ligada por padrão. Fica salva neste
// aparelho (localStorage) e, no app desktop, também no processo
// principal (privacy-settings.json) — que é quem de fato para a
// detecção de processos quando desligada (ver electron/main.cjs).

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
    // armazenamento bloqueado — vale só nesta sessão (o evento abaixo ainda avisa)
  }
  window.electronAPI?.setGameDetectionEnabled?.(enabled).catch(() => {
    // processo principal antigo, sem esse IPC — o renderer ainda para de gravar
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
