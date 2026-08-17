// Rascunho de mensagem por canal/thread/conversa — guardado em memória
// (não sobrevive a fechar o app, só evita perder o texto ao trocar de
// lugar e voltar durante a mesma sessão).
const draftStore = new Map<string, string>()

export function getDraft(key: string): string {
  return draftStore.get(key) ?? ''
}

export function setDraft(key: string, value: string) {
  if (value) draftStore.set(key, value)
  else draftStore.delete(key)
}
