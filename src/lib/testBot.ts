export const TEST_BOT_PROFILE = {
  id: 'test-bot',
  username: 'mamacos_bot',
  display_name: 'Bot de Testes',
  avatar_url: '/logo-192.png',
  status: 'online' as const,
  custom_status: 'Sempre pronto pra testar 🤖',
}

interface ReplyRule {
  keywords: string[]
  replies: string[]
}

const RULES: ReplyRule[] = [
  {
    keywords: ['oi', 'ola', 'olá', 'eae', 'e ai', 'e aí', 'salve'],
    replies: ['E aí! Tudo certo por aqui, pronto pra testar o que precisar. 🤖', 'Oi! Bot de Testes online e funcionando.'],
  },
  {
    keywords: ['audio', 'áudio', 'som', 'microfone', 'mic', 'fone', 'headset'],
    replies: [
      'Pra testar áudio de verdade (ouvir sua própria voz no fone), vai em Configurações > Voz e Vídeo > "Ouvir a si mesmo (eco)". Eu aqui só respondo texto! 🎧',
      'Testando, testando! Se você me leu, seu chat tá funcionando. Pra testar o microfone com eco de verdade, usa o botão de eco nas Configurações.',
    ],
  },
  {
    keywords: ['tela', 'compartilh', 'screen'],
    replies: [
      'Pra testar compartilhamento de tela, entra sozinho num canal de voz e clica no ícone de tela — você vai ver o preview da sua própria tela compartilhada ali mesmo.',
    ],
  },
  {
    keywords: ['reaç', 'reacao', 'reação', 'emoji'],
    replies: ['Passa o mouse em cima de uma das minhas mensagens e clica no ícone de carinha pra reagir — funciona igual com qualquer mensagem no servidor!'],
  },
  {
    keywords: ['ping'],
    replies: ['pong! 🏓'],
  },
  {
    keywords: ['obrigado', 'obrigada', 'valeu', 'vlw'],
    replies: ['De nada! Qualquer coisa é só chamar. 🤖'],
  },
]

const FALLBACK_REPLIES = [
  'Recebi: "{msg}" — mensagem entregue e lida, tudo funcionando por aqui!',
  'Testando o chat com "{msg}"? Beleza, chegou certinho.',
  'Anotado: "{msg}". O chat tá 100%.',
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function generateBotReply(userMessage: string): string {
  const normalized = normalize(userMessage)

  for (const rule of RULES) {
    if (rule.keywords.some((k) => normalized.includes(normalize(k)))) {
      return rule.replies[Math.floor(Math.random() * rule.replies.length)]
    }
  }

  const template = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)]
  const truncated = userMessage.length > 60 ? `${userMessage.slice(0, 60)}...` : userMessage
  return template.replace('{msg}', truncated)
}
