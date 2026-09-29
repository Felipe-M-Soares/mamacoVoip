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

// Ao sair da conta, rascunhos da conta anterior não podem aparecer pra
// próxima pessoa que entrar na mesma janela.
if (typeof window !== 'undefined') {
  window.addEventListener('mamacos:signed-out', () => draftStore.clear())
}
