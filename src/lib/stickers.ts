// Figurinhas originais do Mamacos Voip (desenhadas pra este app, em SVG
// — src/assets/stickers/). Não mexem no banco: uma figurinha é enviada
// como uma mensagem de texto comum no formato `[[sticker:<id>]]`, e quem
// renderiza a mensagem (parseMessageContent) troca o texto pela imagem.
// Se o id não existir (versão antiga do app, pacote removido), a
// mensagem cai num texto de fallback em vez de sumir.

const files = import.meta.glob('../assets/stickers/*.svg', { eager: true, query: '?no-inline', import: 'default' }) as Record<
  string,
  string
>

export interface Sticker {
  id: string
  label: string
  /** Palavras extras pra busca (além do nome) */
  tags: string[]
  url: string
}

const META: { id: string; label: string; tags: string[] }[] = [
  { id: 'gg', label: 'GG', tags: ['good game', 'vitória', 'parabéns'] },
  { id: 'ez', label: 'EZ', tags: ['fácil', 'easy', 'óculos'] },
  { id: 'clutch', label: 'Clutch', tags: ['raio', 'jogada', 'salvou'] },
  { id: 'hype', label: 'Hype', tags: ['fogo', 'animado', 'empolgado'] },
  { id: 'rage-quit', label: 'Rage quit', tags: ['raiva', 'controle quebrado', 'desisto'] },
  { id: 'noob', label: 'Noob', tags: ['iniciante', 'planta', 'novato'] },
  { id: 'afk', label: 'AFK', tags: ['ausente', 'ampulheta', 'já volto'] },
  { id: 'lag', label: 'Lag', tags: ['lento', 'caracol', 'ping', 'internet'] },
  { id: 'bora-jogar', label: 'Bora jogar?', tags: ['convite', 'jogar', 'partida'] },
  { id: 'partiu', label: 'Partiu!', tags: ['foguete', 'vamos', 'bora'] },
  { id: 'rindo', label: 'Rindo', tags: ['feliz', 'risada', 'haha', 'kkk'] },
  { id: 'chorando-de-rir', label: 'Chorando de rir', tags: ['kkkk', 'risada', 'rindo muito'] },
  { id: 'triste', label: 'Triste', tags: ['chorando', 'sad', 'lágrima'] },
  { id: 'bravo', label: 'Bravo', tags: ['raiva', 'irritado', 'nervoso'] },
  { id: 'sono', label: 'Sono', tags: ['dormindo', 'zzz', 'cansado'] },
  { id: 'coracao', label: 'Coração', tags: ['amor', 'love', 'curti'] },
  { id: 'joinha', label: 'Joinha', tags: ['ok', 'like', 'positivo', 'beleza'] },
  { id: 'pipoca', label: 'Pipoca', tags: ['assistindo', 'drama', 'filme'] },
  { id: 'cafe', label: 'Café', tags: ['bom dia', 'caneca', 'coffee'] },
  { id: 'refri', label: 'Refri', tags: ['bebida', 'lata', 'cerveja', 'gelada'] },
  { id: 'trofeu', label: 'Troféu', tags: ['campeão', 'vitória', 'ganhou'] },
  { id: 'controle', label: 'Controle', tags: ['jogo', 'gamepad', 'console'] },
  { id: 'headset', label: 'Headset', tags: ['fone', 'call', 'áudio'] },
  { id: 'mascote-oi', label: 'Mamaco: oi!', tags: ['macaco', 'mascote', 'olá', 'piscadinha'] },
  { id: 'mascote-rindo', label: 'Mamaco: rindo', tags: ['macaco', 'mascote', 'risada', 'kkk'] },
  { id: 'mascote-bravo', label: 'Mamaco: bravo', tags: ['macaco', 'mascote', 'raiva'] },
  { id: 'mascote-triste', label: 'Mamaco: triste', tags: ['macaco', 'mascote', 'chorando'] },
]

function urlFor(id: string): string | undefined {
  return files[`../assets/stickers/${id}.svg`]
}

export const STICKERS: Sticker[] = META.flatMap((m) => {
  const url = urlFor(m.id)
  return url ? [{ ...m, url }] : []
})

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]))

export function getSticker(id: string): Sticker | undefined {
  return BY_ID.get(id)
}

const STICKER_RE = /^\s*\[\[sticker:([a-z0-9-]{1,40})\]\]\s*$/

/** Texto que vai no banco pra uma figurinha. */
export function stickerMessage(id: string): string {
  return `[[sticker:${id}]]`
}

/**
 * Se a mensagem INTEIRA é uma figurinha, devolve o id (mesmo que não
 * exista no pacote atual — quem chama decide o fallback). Texto com a
 * marcação no meio de outras palavras não conta como figurinha.
 */
export function parseStickerId(content: string): string | null {
  const m = STICKER_RE.exec(content)
  return m ? m[1] : null
}

/** Versão curta pra notificações, respostas e pré-visualizações. */
export function describeMessageContent(content: string): string {
  const id = parseStickerId(content)
  if (!id) return content
  const sticker = getSticker(id)
  return sticker ? `[Figurinha: ${sticker.label}]` : '[Figurinha]'
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function searchStickers(query: string): Sticker[] {
  const q = normalize(query.trim())
  if (!q) return STICKERS
  return STICKERS.filter((s) => [s.id, s.label, ...s.tags].some((t) => normalize(t).includes(q)))
}

// ------------------------------------------------------------ recentes

const RECENT_KEY = 'mamacos-recent-stickers'
const MAX_RECENT = 8

export function getRecentStickers(): Sticker[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(ids)) return []
    return ids.flatMap((id) => {
      const s = typeof id === 'string' ? BY_ID.get(id) : undefined
      return s ? [s] : []
    })
  } catch {
    return []
  }
}

export function pushRecentSticker(id: string) {
  try {
    const current = getRecentStickers().map((s) => s.id).filter((x) => x !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...current].slice(0, MAX_RECENT)))
  } catch {
    // best-effort
  }
}
