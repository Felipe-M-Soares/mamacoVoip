import type { ScreenShareSourcesPayload } from '../hooks/useGamePresence'

// OITAVA RODADA: mesma ideia de "caixa de correio" em memória de
// screenShareGameHint.ts/pendingAppAudioCapture.ts, mas nos DOIS sentidos —
// porque o ScreenSharePicker.tsx deixou de ficar plantado escutando um
// evento (onScreenShareSources) e passou a ser "aberto" ativamente por
// quem quer mostrar ele (VoiceContext.tsx, em toggleScreenShare/
// switchScreenShareSource), depois de já ter buscado a lista de fontes via
// window.electronAPI.getScreenShareSources().
//
// Por que não simplesmente renderizar o picker condicionalmente dentro do
// próprio VoiceContext? Porque o picker é montado uma vez só, fora do
// VoiceProvider, lá no topo do app (mesmo motivo de loadQuality() em
// useScreenShareQuality.ts) — então a comunicação entre os dois precisa
// passar por fora da árvore de componentes, e uma Promise é a forma mais
// direta de "VoiceContext pede, espera a pessoa escolher, recebe de
// volta o sourceId (ou null se cancelou)" sem precisar de estado extra
// em nenhum dos dois lados.
type Listener = (payload: ScreenShareSourcesPayload | null) => void

let listener: Listener | null = null
let pendingResolve: ((sourceId: string | null) => void) | null = null

export function subscribeScreenSharePicker(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

// Mostra o picker com essa lista de fontes e devolve uma Promise que só
// resolve quando a pessoa escolhe algo (sourceId) ou cancela (null) — ver
// resolveScreenSharePicker abaixo, chamada de dentro do
// ScreenSharePicker.tsx. Se já existir um pedido pendente (não deveria
// acontecer na prática, já que o picker cobre a tela inteira antes de
// abrir outro), resolve o anterior como cancelado antes de seguir, pra
// nunca deixar uma Promise pendurada pra sempre.
export function openScreenSharePicker(payload: ScreenShareSourcesPayload): Promise<string | null> {
  if (pendingResolve) {
    const resolve = pendingResolve
    pendingResolve = null
    resolve(null)
  }
  return new Promise((resolve) => {
    pendingResolve = resolve
    listener?.(payload)
  })
}

export function resolveScreenSharePicker(sourceId: string | null) {
  const resolve = pendingResolve
  pendingResolve = null
  listener?.(null)
  resolve?.(sourceId)
}
