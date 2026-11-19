const draftStore = new Map<string, string>()

export function getDraft(key: string): string {
  return draftStore.get(key) ?? ''
}

export function setDraft(key: string, value: string) {
  if (value) draftStore.set(key, value)
  else draftStore.delete(key)
}

if (typeof window !== 'undefined') {
  window.addEventListener('mamacos:signed-out', () => draftStore.clear())
}
