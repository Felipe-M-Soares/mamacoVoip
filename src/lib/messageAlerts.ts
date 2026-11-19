export type IncomingKind = 'dm' | 'group'

export interface IncomingMessage {
  kind: IncomingKind
  targetId: string
  messageId: string
  authorId: string
  content: string
}

type Listener = (m: IncomingMessage) => void
const listeners = new Set<Listener>()
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
    }
  }
}

export type AlertMode = 'none' | 'toast' | 'system'

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

export function previewText(content: string | null | undefined, max = 120): string {
  const clean = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Enviou um anexo'
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function isAppFocused(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible' && document.hasFocus()
}
