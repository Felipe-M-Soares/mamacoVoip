import { useState, type ReactNode } from 'react'
import type { Profile, ServerEmoji, Role } from '../types/database'
import { getSticker, parseStickerId } from './stickers'

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
          ? 'bg-mv-raised/40'
          : 'bg-mv-raised text-transparent select-none cursor-pointer hover:bg-mv-raised/80'
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
        className="bg-mv-canvas border border-[var(--color-line)] rounded-lg px-3 py-2.5 my-1.5 overflow-x-auto text-[13px] leading-relaxed font-mono whitespace-pre-wrap"
      >
        <code>{inner.replace(/^\n/, '')}</code>
      </pre>
    ),
  },
  {
    // código inline `...`
    regex: /`([^`\n]+)`/,
    render: (inner, key) => (
      <code key={key} className="bg-mv-canvas border border-[var(--color-line)] rounded-md px-1.5 py-0.5 text-[0.85em] font-mono">
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

// Aceita só cor hexadecimal (#rgb, #rrggbb) — a cor do cargo vem do
// banco e é escrita direto em `style`; qualquer outra coisa cai pra cor
// padrão em vez de ir parar no CSS.
export function safeHexColor(color: string | null | undefined, fallback = '#99aab5'): string {
  return typeof color === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback
}

// Só devolve a URL se for http(s) de verdade — protege href/src que vêm
// do banco (anexos, emoji, preview de link) contra "javascript:",
// "data:" etc., que num <a href> executariam código na origem do app.
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

const CODE_PATTERN_COUNT = 2 // os dois primeiros PATTERNS são de código (literal)

// Figurinha: a mensagem inteira é `[[sticker:<id>]]` (ver lib/stickers.ts).
// Vira uma imagem grande, sem nenhuma outra formatação em volta; id
// desconhecido cai num texto discreto em vez de mostrar a marcação crua.
function renderSticker(id: string): ReactNode {
  const sticker = getSticker(id)
  if (!sticker) {
    return (
      <span key="sticker" className="italic text-mv-muted" data-sticker-missing={id}>
        [figurinha indisponível]
      </span>
    )
  }
  return (
    <img
      key="sticker"
      src={sticker.url}
      alt={`Figurinha: ${sticker.label}`}
      title={sticker.label}
      width={140}
      height={140}
      loading="lazy"
      draggable={false}
      data-sticker={sticker.id}
      className="block w-[140px] h-[140px] my-1 select-none object-contain"
    />
  )
}

export function parseMessageContent(text: string, members: Profile[], emojis: ServerEmoji[] = [], roles: Role[] = []): ReactNode[] {
  const stickerId = parseStickerId(text)
  if (stickerId) return [renderSticker(stickerId)]

  const usernames = new Set(members.map((m) => m.username.toLowerCase()))
  const emojiByName = new Map(emojis.map((e) => [e.name.toLowerCase(), e]))
  const sortedRoles = [...roles].filter((r) => r.name.length > 0).sort((a, b) => b.name.length - a.name.length)

  function splitAround(
    segment: string,
    index: number,
    length: number,
    node: ReactNode,
    keyPrefix: string,
    parseBefore: (t: string, k: string) => ReactNode[] = parse
  ): ReactNode[] {
    const before = segment.slice(0, index)
    const after = segment.slice(index + length)
    return [
      ...(before ? parseBefore(before, `${keyPrefix}b`) : []),
      node,
      ...(after ? parse(after, `${keyPrefix}a`) : []),
    ]
  }

  function parse(segment: string, keyPrefix: string): ReactNode[] {
    // Código (``` e `) primeiro: dentro de código nada é interpretado
    // (antes, :emoji: e @menção dentro de um bloco de código eram
    // transformados mesmo assim, quebrando o bloco).
    let codeMatch: { i: number; match: RegExpMatchArray } | null = null
    for (let i = 0; i < CODE_PATTERN_COUNT; i++) {
      const m = segment.match(PATTERNS[i].regex)
      if (m && m.index !== undefined && (!codeMatch || m.index < (codeMatch.match.index ?? 0))) {
        codeMatch = { i, match: m }
      }
    }
    if (codeMatch && codeMatch.match.index !== undefined) {
      const { i, match } = codeMatch
      const key = `${keyPrefix}-${i}-${match.index}`
      return splitAround(segment, match.index!, match[0].length, PATTERNS[i].render(match[1], key, parse), keyPrefix)
    }

    // Emoji customizado :nome: — procura o PRIMEIRO que realmente
    // existe no servidor (antes só olhava o primeiro ":algo:" do texto;
    // se esse não fosse um emoji, os seguintes nunca eram renderizados).
    if (emojiByName.size > 0) {
      for (const emojiMatch of segment.matchAll(/:([a-z0-9_]+):/gi)) {
        const emoji = emojiByName.get(emojiMatch[1].toLowerCase())
        const src = emoji ? safeHttpUrl(emoji.image_url) : null
        if (emoji && src && emojiMatch.index !== undefined) {
          const key = `${keyPrefix}-e-${emojiMatch.index}`
          return splitAround(
            segment,
            emojiMatch.index,
            emojiMatch[0].length,
            <img
              key={key}
              src={src}
              alt={emojiMatch[0]}
              title={emojiMatch[0]}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="inline-block w-5 h-5 align-text-bottom object-contain mx-0.5"
            />,
            keyPrefix
          )
        }
      }
    }

    // Menção de cargo (@Nome do Cargo) — checada antes da de usuário
    // porque nomes de cargo podem ter espaço, o que a regex de usuário
    // não cobre. Olha todos os "@" do trecho, não só o primeiro.
    if (sortedRoles.length > 0) {
      let atIndex = segment.indexOf('@')
      while (atIndex !== -1) {
        const afterAt = segment.slice(atIndex + 1).toLowerCase()
        const matchedRole = sortedRoles.find((r) => afterAt.startsWith(r.name.toLowerCase()))
        if (matchedRole) {
          const key = `${keyPrefix}-r-${atIndex}`
          const color = safeHexColor(matchedRole.color)
          return splitAround(
            segment,
            atIndex,
            1 + matchedRole.name.length,
            <span key={key} className="rounded px-1 font-medium" style={{ backgroundColor: `${color}30`, color }}>
              @{matchedRole.name}
            </span>,
            keyPrefix
          )
        }
        atIndex = segment.indexOf('@', atIndex + 1)
      }
    }

    // Menções (@username, @everyone, @here) — checadas depois da de cargo, nesse
    // segmento, sem interferir na formatação — texto puro fora delas
    // continua indo pros outros padrões (negrito, itálico, etc.). Procura
    // a primeira menção VÁLIDA (ex: "email@site.com @joao" ainda destaca
    // o @joao).
    for (const mentionMatch of segment.matchAll(/@(everyone|here|[a-zA-Z0-9_.]+)/g)) {
      const word = mentionMatch[1].toLowerCase()
      const isBroadcast = word === 'everyone' || word === 'here'
      const isUser = usernames.has(word)
      if ((isBroadcast || isUser) && mentionMatch.index !== undefined) {
        const key = `${keyPrefix}-m-${mentionMatch.index}`
        return splitAround(
          segment,
          mentionMatch.index,
          mentionMatch[0].length,
          <span
            key={key}
            className={
              isBroadcast
                ? 'bg-amber-400/15 text-amber-300 rounded px-1 font-medium'
                : 'bg-mv-accent/15 text-mv-accent rounded px-1 font-medium hover:bg-mv-accent/25 transition-colors'
            }
          >
            {mentionMatch[0]}
          </span>,
          keyPrefix,
          parseFormatting
        )
      }
    }
    return parseFormatting(segment, keyPrefix)
  }

  function parseFormatting(segment: string, keyPrefix: string): ReactNode[] {
    for (let i = CODE_PATTERN_COUNT; i < PATTERNS.length; i++) {
      const { regex, render } = PATTERNS[i]
      const match = segment.match(regex)
      if (match && match.index !== undefined) {
        const key = `${keyPrefix}-${i}-${match.index}`
        return splitAround(segment, match.index, match[0].length, render(match[1], key, parse), keyPrefix)
      }
    }
    return segment ? [segment] : []
  }

  return parse(text, '0')
}
