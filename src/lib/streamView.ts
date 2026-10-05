import { useSyncExternalStore } from 'react'

// Como VOCÊ está assistindo as transmissões da sala (só local, não afeta
// ninguém): quais você fechou e qual está em destaque.
//  - Transmissão fechada = sem vídeo E sem som. Antes, fechar só sumia
//    com o vídeo e o som continuava tocando por cima da outra.
//  - Em destaque = aparece grande; as outras ficam em miniatura do lado.
// A chave é o id do usuário que transmite ('local' = a sua).

type State = { hidden: ReadonlySet<string>; focused: string | null }

let state: State = { hidden: new Set(), focused: null }
const listeners = new Set<() => void>()
// Transmissões que já apareceram nesta call (pra saber quais são novas).
const seen = new Set<string>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

export function useStreamView(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state
  )
}

export function getStreamView(): State {
  return state
}

export function subscribeStreamView(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Atualiza com as transmissões ativas agora. Transmissão NOVA de outra
 * pessoa começa FECHADA (só baixa o vídeo quem clicar em "Assistir") —
 * é o que mais gasta internet/servidor: antes todo mundo da sala recebia
 * toda transmissão em 1080p o tempo todo, mesmo sem olhar.
 * Quem parou de transmitir sai da lista.
 */
export function syncActiveStreams(active: ReadonlySet<string>, startClosed = true) {
  const hidden = new Set(state.hidden)
  let focused = state.focused
  let changed = false
  for (const key of [...seen]) {
    if (active.has(key)) continue
    seen.delete(key)
    if (hidden.delete(key)) changed = true
    if (focused === key) {
      focused = null
      changed = true
    }
  }
  for (const key of active) {
    if (seen.has(key)) continue
    seen.add(key)
    if (startClosed && key !== 'local' && focused !== key && !hidden.has(key)) {
      hidden.add(key)
      changed = true
    }
  }
  if (changed) set({ hidden, focused })
}

/** Fecha (para de assistir) uma transmissão: some o vídeo e o som. */
export function hideStream(key: string) {
  const hidden = new Set(state.hidden)
  hidden.add(key)
  set({ hidden, focused: state.focused === key ? null : state.focused })
}

/** Volta a assistir uma transmissão fechada. */
export function showStream(key: string) {
  if (!state.hidden.has(key)) return
  const hidden = new Set(state.hidden)
  hidden.delete(key)
  set({ ...state, hidden })
}

/** Assiste e coloca em destaque (grande). `null` = sem destaque (grade). */
export function focusStream(key: string | null) {
  if (key === null) {
    set({ ...state, focused: null })
    return
  }
  const hidden = new Set(state.hidden)
  hidden.delete(key)
  set({ hidden, focused: key })
}

/** Ao sair da call: esquece tudo. */
export function resetStreamView() {
  seen.clear()
  if (state.hidden.size === 0 && state.focused === null) return
  set({ hidden: new Set(), focused: null })
}

/** Pedido de "abrir a transmissão de X" vindo de outro lugar (ex.: "Ao vivo" na lista). */
export function requestWatchStream(serverId: string, channelId: string, key: string) {
  focusStream(key)
  window.dispatchEvent(new CustomEvent('mv:open-voice-room', { detail: { serverId, channelId } }))
}
