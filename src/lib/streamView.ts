import { useSyncExternalStore } from 'react'

// Como VOCÊ está assistindo as transmissões da sala (só local, não afeta
// ninguém): quais você fechou e qual está em destaque.
//  - Transmissão fechada = sem vídeo E sem som. Antes, fechar só sumia
//    com o vídeo e o som continuava tocando por cima da outra.
//  - Em destaque = aparece grande; as outras ficam em miniatura do lado.
// A chave é o id do usuário que transmite ('local' = a sua).

// Qualidade que VOCÊ escolheu pra cada transmissão. 'auto' = a melhor que
// a sua internet aguenta (o servidor baixa sozinho se a conexão apertar).
// Só funciona quando quem transmite manda mais de uma versão (H.264/VP8);
// com VP9/AV1 sempre chega a original.
export type StreamQuality = 'auto' | 'media' | 'baixa'

type State = { hidden: ReadonlySet<string>; focused: string | null; quality: ReadonlyMap<string, StreamQuality> }

let state: State = { hidden: new Set(), focused: null, quality: new Map() }
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
  let quality = state.quality
  for (const key of quality.keys()) {
    if (active.has(key)) continue
    if (quality === state.quality) quality = new Map(quality)
    ;(quality as Map<string, StreamQuality>).delete(key)
    changed = true
  }
  if (changed) set({ hidden, focused, quality })
}

/** Escolhe a qualidade de uma transmissão (só pra você). */
export function setStreamQuality(key: string, q: StreamQuality) {
  if ((state.quality.get(key) ?? 'auto') === q) return
  const quality = new Map(state.quality)
  if (q === 'auto') quality.delete(key)
  else quality.set(key, q)
  set({ ...state, quality })
}

export function getStreamQuality(key: string): StreamQuality {
  return state.quality.get(key) ?? 'auto'
}

/** Fecha (para de assistir) uma transmissão: some o vídeo e o som. */
export function hideStream(key: string) {
  const hidden = new Set(state.hidden)
  hidden.add(key)
  set({ ...state, hidden, focused: state.focused === key ? null : state.focused })
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
  set({ ...state, hidden, focused: key })
}

/** Ao sair da call: esquece tudo. */
export function resetStreamView() {
  seen.clear()
  if (state.hidden.size === 0 && state.focused === null && state.quality.size === 0) return
  set({ hidden: new Set(), focused: null, quality: new Map() })
}

/** Pedido de "abrir a transmissão de X" vindo de outro lugar (ex.: "Ao vivo" na lista). */
export function requestWatchStream(serverId: string, channelId: string, key: string) {
  focusStream(key)
  window.dispatchEvent(new CustomEvent('mv:open-voice-room', { detail: { serverId, channelId } }))
}
