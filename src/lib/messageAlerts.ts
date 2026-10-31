// Alerta de mensagem privada (DM e grupo) chegando — com som, aviso
// discreto no canto da tela e notificação do sistema quando o app está
// em segundo plano.
//
// Antes o aviso só existia DENTRO da conversa aberta (useDirectMessages /
// useGroupMessages): se você estava em outro lugar do app — num servidor,
// na lista de amigos, em outra conversa — não tocava nada e não aparecia
// nada; a bolinha de não lido só vinha na próxima consulta (até 20 s
// depois) e nem aparecia dentro de um servidor.
//
// Agora as inscrições de tempo real que JÁ existem (lista de conversas,
// em useConversations, e lista de grupos, em GroupConversationsContext)
// avisam aqui toda mensagem nova — sem abrir conexão a mais. O componente
// MessageAlerts (montado uma vez no MainLayout) decide o que fazer.

export type IncomingKind = 'dm' | 'group'

export interface IncomingMessage {
  kind: IncomingKind
  /** id da conversa (DM) ou do grupo */
  targetId: string
  messageId: string
  authorId: string
  content: string
}

type Listener = (m: IncomingMessage) => void
const listeners = new Set<Listener>()
// A mesma mensagem pode chegar por mais de uma inscrição (ex.: reconexão).
const seen: string[] = []
const seenSet = new Set<string>()

export function onIncomingMessage(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function emitIncomingMessage(m: IncomingMessage) {
  if (!m.messageId || seenSet.has(m.messageId)) return
  seenSet.add(m.messageId)
  seen.push(m.messageId)
  if (seen.length > 300) seenSet.delete(seen.shift()!)
  for (const l of [...listeners]) {
    try {
      l(m)
    } catch {
      // um ouvinte com erro não pode travar os outros
    }
  }
}

export type AlertMode = 'none' | 'toast' | 'system'

/**
 * O que fazer com uma mensagem que chegou:
 *  - sua, de alguém bloqueado → nada;
 *  - você está OLHANDO pra essa conversa (aberta + janela em foco) → nada
 *    (a mensagem já aparece na tela);
 *  - app em foco, mas em outro lugar → aviso discreto no canto + som;
 *  - app minimizado/em segundo plano → notificação do sistema + som.
 */
export function decideAlert(opts: {
  message: Pick<IncomingMessage, 'targetId' | 'authorId'>
  myId: string | null
  viewingTargetId: string | null
  appFocused: boolean
  blockedIds?: ReadonlySet<string>
}): AlertMode {
  const { message, myId, viewingTargetId, appFocused, blockedIds } = opts
  if (!myId || message.authorId === myId) return 'none'
  if (blockedIds?.has(message.authorId)) return 'none'
  if (appFocused && viewingTargetId === message.targetId) return 'none'
  return appFocused ? 'toast' : 'system'
}

/** Texto curto pra prévia (uma linha). */
export function previewText(content: string | null | undefined, max = 120): string {
  const clean = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Enviou um anexo'
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function isAppFocused(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible' && document.hasFocus()
}
