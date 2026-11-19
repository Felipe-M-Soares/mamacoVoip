export interface PendingGameShareHint {
  processNames: string[]
  label: string
}

let pendingGameShareHint: PendingGameShareHint | null = null

export function setPendingGameShareHint(hint: PendingGameShareHint | null) {
  pendingGameShareHint = hint
}

export function takePendingGameShareHint(): PendingGameShareHint | null {
  const value = pendingGameShareHint
  pendingGameShareHint = null
  return value
}

export function peekPendingGameShareHint(): PendingGameShareHint | null {
  return pendingGameShareHint
}
