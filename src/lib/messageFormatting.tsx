import { useState, type ReactNode } from 'react'
import type { Profile, ServerEmoji, Role } from '../types/database'

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        setRevealed(true)
      }}
      className={`rounded px-1 transition-colors ${
        revealed
          ? 'bg-discord-lighter/40'
          : 'bg-discord-lighter text-transparent select-none cursor-pointer hover:bg-discord-lighter/80'
      }`}
    >
      {children}
    </span>
  )
}

type Pattern = {
  regex: RegExp
  render: (inner: string, key: string, parseChildren: (t: string, k: string) => ReactNode[]) => ReactNode
}

const PATTERNS: Pattern[] = [
  {
    // bloco de código ```...```
    regex: /```([\s\S]*?)```/,
    render: (inner, key) => (
      <pre
        key={key}
        className="bg-discord-darker rounded p-2 my-1 overflow-x-auto text-xs font-mono whitespace-pre-wrap"
      >
        <code>{inner.replace(/^\n/, '')}</code>
      </pre>
    ),
  },
  {
    // código inline `...`
    regex: /`([^`\n]+)`/,
    render: (inner, key) => (
      <code key={key} className="bg-discord-darker rounded px-1 py-0.5 text-[0.85em] font-mono">
        {inner}
      </code>
    ),
  },
  {
    // spoiler ||...||
    regex: /\|\|([\s\S]+?)\|\|/,
    render: (inner, key, parseChildren) => <Spoiler key={key}>{parseChildren(inner, key)}</Spoiler>,
  },
  {
    // negrito **...**
    regex: /\*\*([\s\S]+?)\*\*/,
    render: (inner, key, parseChildren) => <strong key={key}>{parseChildren(inner, key)}</strong>,
  },
  {
    // tachado ~~...~~
    regex: /~~([\s\S]+?)~~/,
    render: (inner, key, parseChildren) => <s key={key}>{parseChildren(inner, key)}</s>,
  },
  {
    // itálico *...* (evita conflito com negrito por já ter sido consumido acima)
    regex: /\*([^*\n]+)\*/,
    render: (inner, key, parseChildren) => <em key={key}>{parseChildren(inner, key)}</em>,
  },
  {
    // itálico _..._
    regex: /_([^_\n]+)_/,
    render: (inner, key, parseChildren) => <em key={key}>{parseChildren(inner, key)}</em>,
  },
]

export function parseMessageContent(text: string, members: Profile[], emojis: ServerEmoji[] = [], roles: Role[] = []): ReactNode[] {
  const usernames = new Set(members.map((m) => m.username.toLowerCase()))
  const emojiByName = new Map(emojis.map((e) => [e.name.toLowerCase(), e]))
  const sortedRoles = [...roles].sort((a, b) => b.name.length - a.name.length)

  function parse(segment: string, keyPrefix: string): ReactNode[] {
    // Emoji customizado :nome: — checado antes de qualquer outra coisa,
    // já que o : não tem nenhum outro significado especial no resto do
    // parser.
    if (emojiByName.size > 0) {
      const emojiMatch = segment.match(/:([a-z0-9_]+):/)
      if (emojiMatch && emojiMatch.index !== undefined) {
        const emoji = emojiByName.get(emojiMatch[1].toLowerCase())
        if (emoji) {
          const before = segment.slice(0, emojiMatch.index)
          const after = segment.slice(emojiMatch.index + emojiMatch[0].length)
          const key = `${keyPrefix}-e-${emojiMatch.index}`
          return [
            ...(before ? parse(before, `${keyPrefix}b`) : []),
            <img
              key={key}
              src={emoji.image_url}
              alt={emojiMatch[0]}
              title={emojiMatch[0]}
              className="inline-block w-5 h-5 align-text-bottom object-contain mx-0.5"
            />,
            ...(after ? parse(after, `${keyPrefix}a`) : []),
          ]
        }
      }
    }

    // Menção de cargo (@Nome do Cargo) — checada antes da de usuário
    // porque nomes de cargo podem ter espaço, o que a regex de usuário
    // não cobre.
    if (sortedRoles.length > 0) {
      const atIndex = segment.indexOf('@')
      if (atIndex !== -1) {
        const afterAt = segment.slice(atIndex + 1)
        const matchedRole = sortedRoles.find((r) => afterAt.toLowerCase().startsWith(r.name.toLowerCase()))
        if (matchedRole) {
          const before = segment.slice(0, atIndex)
          const after = segment.slice(atIndex + 1 + matchedRole.name.length)
          const key = `${keyPrefix}-r-${atIndex}`
          return [
            ...(before ? parse(before, `${keyPrefix}b`) : []),
            <span
              key={key}
              className="rounded px-1 font-medium"
              style={{ backgroundColor: `${matchedRole.color}30`, color: matchedRole.color }}
            >
              @{matchedRole.name}
            </span>,
            ...(after ? parse(after, `${keyPrefix}a`) : []),
          ]
        }
      }
    }

    // Menções (@username, @everyone, @here) — checadas depois da de cargo, nesse
    // segmento, sem interferir na formatação — texto puro fora delas
    // continua indo pros outros padrões (negrito, itálico, etc.)
    const mentionMatch = segment.match(/@(everyone|here|[a-zA-Z0-9_.]+)/)
    if (mentionMatch && mentionMatch.index !== undefined) {
      const word = mentionMatch[1].toLowerCase()
      const isBroadcast = word === 'everyone' || word === 'here'
      const isUser = usernames.has(word)
      if (isBroadcast || isUser) {
        const before = segment.slice(0, mentionMatch.index)
        const after = segment.slice(mentionMatch.index + mentionMatch[0].length)
        const key = `${keyPrefix}-m-${mentionMatch.index}`
        return [
          ...(before ? parseFormatting(before, `${keyPrefix}b`) : []),
          <span
            key={key}
            className={
              isBroadcast
                ? 'bg-yellow-500/20 text-yellow-400 rounded px-1 font-medium'
                : 'bg-discord-blurple/30 text-discord-blurple rounded px-1 font-medium'
            }
          >
            {mentionMatch[0]}
          </span>,
          ...(after ? parse(after, `${keyPrefix}a`) : []),
        ]
      }
    }
    return parseFormatting(segment, keyPrefix)
  }

  function parseFormatting(segment: string, keyPrefix: string): ReactNode[] {
    for (let i = 0; i < PATTERNS.length; i++) {
      const { regex, render } = PATTERNS[i]
      const match = segment.match(regex)
      if (match && match.index !== undefined) {
        const before = segment.slice(0, match.index)
        const after = segment.slice(match.index + match[0].length)
        const key = `${keyPrefix}-${i}-${match.index}`
        return [
          ...(before ? parse(before, `${keyPrefix}b`) : []),
          render(match[1], key, parse),
          ...(after ? parse(after, `${keyPrefix}a`) : []),
        ]
      }
    }
    return segment ? [segment] : []
  }

  return parse(text, '0')
}
