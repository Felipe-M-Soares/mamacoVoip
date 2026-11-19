export const WELCOME_MESSAGES = [
  '{nome} chegou chegando! Seja bem-vindo(a) 🎉',
  'Abram alas: {nome} acabou de entrar no servidor!',
  '{nome} pousou no servidor. Bem-vindo(a) à bagunça! 🛬',
  'Um(a) {nome} selvagem apareceu! 🌿',
  '{nome} entrou na party. Bora jogar? 🎮',
  'Respawn confirmado: {nome} está entre nós! ✨',
  '{nome} acabou de chegar. Alguém passa o controle! 🕹️',
  'Segura que lá vem {nome}! Seja bem-vindo(a) 🚀',
  'Mais um(a) pro time: {nome} entrou no servidor! 🏆',
  '{nome} chegou com o lanche? Bem-vindo(a)! 🍕',
  'Novo player na área: {nome}! GG pela chegada 👊',
  '{nome} desbloqueou a conquista "Entrou no servidor" 🏅',
  'Atenção, galera: {nome} acabou de entrar! Façam barulho 📣',
  '{nome} caiu de paraquedas aqui. Seja bem-vindo(a)! 🪂',
  'Carregando... 100%! {nome} entrou no servidor ✅',
  'Chegou quem faltava: {nome}! 😎',
  '{nome} entrou sem lag. Bem-vindo(a)! ⚡',
  'O servidor ficou mais legal: {nome} chegou! 💜',
  '{nome} apareceu do nada. Fica à vontade! 🛋️',
  'Pode entrar, {nome}, a casa é sua! 🏠',
] as const

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function welcomeMessageParts(messageId: string): { before: string; after: string } {
  const template = WELCOME_MESSAGES[hash(messageId) % WELCOME_MESSAGES.length]
  const [before, after = ''] = template.split('{nome}')
  return { before, after }
}
