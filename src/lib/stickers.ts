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

export type StickerPackId = 'mamacos' | 'reacoes' | 'zoeira' | 'gamer' | 'bichos'

export interface StickerPack {
  id: StickerPackId
  label: string
  /** Figurinha que representa o pacote na aba */
  coverId: string
}

export const STICKER_PACKS: StickerPack[] = [
  { id: 'mamacos', label: 'Mamacos', coverId: 'mascote-oi' },
  { id: 'reacoes', label: 'Reações', coverId: 'apaixonado' },
  { id: 'zoeira', label: 'Zoeira', coverId: 'kkkk' },
  { id: 'gamer', label: 'Gamer', coverId: 'headshot' },
  { id: 'bichos', label: 'Bichos', coverId: 'capivara' },
]

export interface Sticker {
  id: string
  pack: StickerPackId
  label: string
  /** Palavras extras pra busca (além do nome) */
  tags: string[]
  url: string
}

const META: { id: string; pack?: StickerPackId; label: string; tags: string[] }[] = [
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
  { id: 'surpreso', pack: 'reacoes', label: 'Surpreso', tags: ['uau', 'nossa', 'chocado', 'wow'] },
  { id: 'apaixonado', pack: 'reacoes', label: 'Apaixonado', tags: ['amor', 'love', 'crush', 'coração'] },
  { id: 'piscadinha', pack: 'reacoes', label: 'Piscadinha', tags: ['piscando', 'safado', 'hehe', 'wink'] },
  { id: 'pensando', pack: 'reacoes', label: 'Pensando', tags: ['hmm', 'dúvida', 'será', 'pensativo'] },
  { id: 'nervoso', pack: 'reacoes', label: 'Nervoso', tags: ['suando', 'tenso', 'eita', 'ansioso'] },
  { id: 'paisagem', pack: 'reacoes', label: 'Cara de paisagem', tags: ['neutro', 'sem reação', 'ok', 'hm'] },
  { id: 'revirando-olhos', pack: 'reacoes', label: 'Revirando os olhos', tags: ['aff', 'tédio', 'sério', 'eye roll'] },
  { id: 'beijo', pack: 'reacoes', label: 'Beijo', tags: ['beijinho', 'mwah', 'carinho', 'kiss'] },
  { id: 'festa', pack: 'reacoes', label: 'Festa', tags: ['comemorar', 'aniversário', 'parabéns', 'party'] },
  { id: 'vergonha', pack: 'reacoes', label: 'Vergonha', tags: ['tímido', 'corado', 'fofo', 'ops'] },
  { id: 'assustado', pack: 'reacoes', label: 'Assustado', tags: ['medo', 'socorro', 'grito', 'terror'] },
  { id: 'morri', pack: 'reacoes', label: 'Morri', tags: ['morto', 'rip', 'kkkk', 'não aguento'] },
  { id: 'lingua', pack: 'reacoes', label: 'Língua de fora', tags: ['zoeira', 'brincadeira', 'bleh', 'careta'] },
  { id: 'chorando', pack: 'reacoes', label: 'Chorando muito', tags: ['choro', 'triste demais', 'buá', 'sad'] },
  { id: 'sorrisao', pack: 'reacoes', label: 'Sorrisão', tags: ['feliz', 'alegre', 'sorriso', 'eba'] },
  { id: 'desconfiado', pack: 'reacoes', label: 'Desconfiado', tags: ['sus', 'hmmm', 'duvido', 'olhando'] },
  { id: 'sextou', pack: 'zoeira', label: 'Sextou!', tags: ['sexta', 'fim de semana', 'finalmente'] },
  { id: 'tmj', pack: 'zoeira', label: 'TMJ', tags: ['tamo junto', 'parceiro', 'amizade'] },
  { id: 'kkkk', pack: 'zoeira', label: 'KKKK', tags: ['risada', 'rindo', 'kkk', 'hahaha'] },
  { id: 'eita', pack: 'zoeira', label: 'Eita!', tags: ['nossa', 'caramba', 'surpresa'] },
  { id: 'vixe', pack: 'zoeira', label: 'Vixe', tags: ['xiii', 'deu ruim', 'lascou'] },
  { id: 'oxe', pack: 'zoeira', label: 'Oxe', tags: ['ué', 'hein', 'como assim'] },
  { id: 'aff', pack: 'zoeira', label: 'Aff', tags: ['tédio', 'que saco', 'impaciente'] },
  { id: 'slk', pack: 'zoeira', label: 'SLK', tags: ['sei lá', 'caramba', 'mano', 'sério'] },
  { id: 'top', pack: 'zoeira', label: 'Top', tags: ['massa', 'show', 'demais', 'legal'] },
  { id: 'mds', pack: 'zoeira', label: 'MDS', tags: ['meu deus', 'socorro', 'nossa'] },
  { id: 'suave', pack: 'zoeira', label: 'Suave', tags: ['tranquilo', 'de boa', 'relax', 'na paz'] },
  { id: 'bora', pack: 'zoeira', label: 'Bora!', tags: ['vamos', 'partiu', 'simbora'] },
  { id: 'valeu', pack: 'zoeira', label: 'Valeu!', tags: ['obrigado', 'agradeço', 'vlw', 'thanks'] },
  { id: 'bom-dia', pack: 'zoeira', label: 'Bom dia', tags: ['manhã', 'acordei', 'sol'] },
  { id: 'boa-noite', pack: 'zoeira', label: 'Boa noite', tags: ['dormir', 'sono', 'lua', 'fui'] },
  { id: 'f', pack: 'zoeira', label: 'F', tags: ['respeito', 'luto', 'rip', 'press f'] },
  { id: 'headshot', pack: 'gamer', label: 'Headshot', tags: ['tiro', 'na cabeça', 'mira', 'hs'] },
  { id: 'ace', pack: 'gamer', label: 'ACE', tags: ['limpou', '5 kills', 'time todo'] },
  { id: 'gg-wp', pack: 'gamer', label: 'GG WP', tags: ['bom jogo', 'bem jogado', 'fim de partida'] },
  { id: 'carry', pack: 'gamer', label: 'Carry', tags: ['carregando', 'levou o time', 'mvp'] },
  { id: 'tilt', pack: 'gamer', label: 'Tilt', tags: ['tiltado', 'irritado', 'perdendo'] },
  { id: 'buff', pack: 'gamer', label: 'Buff', tags: ['fortalecido', 'mais forte', 'upgrade'] },
  { id: 'nerf', pack: 'gamer', label: 'Nerf', tags: ['enfraquecido', 'mais fraco', 'downgrade'] },
  { id: 'op', pack: 'gamer', label: 'OP', tags: ['apelão', 'roubado', 'forte demais', 'quebrado'] },
  { id: 'sus', pack: 'gamer', label: 'Sus', tags: ['suspeito', 'desconfiado', 'estranho'] },
  { id: 'rush', pack: 'gamer', label: 'Rush!', tags: ['correr', 'bora', 'avançar', 'push'] },
  { id: 'brb', pack: 'gamer', label: 'BRB', tags: ['já volto', 'volto logo', 'pausa'] },
  { id: 'loot', pack: 'gamer', label: 'Loot', tags: ['baú', 'drop', 'recompensa', 'tesouro'] },
  { id: 'respawn', pack: 'gamer', label: 'Respawn', tags: ['renasci', 'voltei', 'de volta'] },
  { id: 'camper', pack: 'gamer', label: 'Camper', tags: ['campando', 'escondido', 'moita'] },
  { id: 'espada', pack: 'gamer', label: 'Espada', tags: ['ataque', 'luta', 'pvp', 'arma'] },
  { id: 'escudo', pack: 'gamer', label: 'Escudo', tags: ['defesa', 'proteção', 'tank'] },
  { id: 'pocao', pack: 'gamer', label: 'Poção', tags: ['vida', 'cura', 'heal', 'mana'] },
  { id: 'moeda', pack: 'gamer', label: 'Moeda', tags: ['dinheiro', 'coin', 'grana', 'gold'] },
  { id: 'caveira', pack: 'gamer', label: 'Caveira', tags: ['morreu', 'game over', 'dead', 'eliminado'] },
  { id: 'coracao-pixel', pack: 'gamer', label: 'Vida extra', tags: ['coração', 'hp', 'vida', 'pixel'] },
  { id: 'bomba', pack: 'gamer', label: 'Bomba', tags: ['explosão', 'boom', 'tnt', 'c4'] },
  { id: 'gato', pack: 'bichos', label: 'Gatinho', tags: ['gato', 'miau', 'fofo', 'cat'] },
  { id: 'cachorro', pack: 'bichos', label: 'Cachorrinho', tags: ['cachorro', 'au au', 'dog', 'doguinho'] },
  { id: 'capivara', pack: 'bichos', label: 'Capivara', tags: ['capivara', 'tranquila', 'de boa', 'brasil'] },
  { id: 'sapo', pack: 'bichos', label: 'Sapinho', tags: ['sapo', 'frog', 'cri cri', 'verde'] },
  { id: 'panda', pack: 'bichos', label: 'Panda', tags: ['panda', 'urso', 'fofo', 'bambu'] },
  { id: 'pato', pack: 'bichos', label: 'Patinho', tags: ['pato', 'quack', 'duck', 'amarelo'] },
  { id: 'preguica', pack: 'bichos', label: 'Preguiça', tags: ['preguiça', 'cansado', 'lento', 'sono'] },
  { id: 'coruja', pack: 'bichos', label: 'Coruja', tags: ['coruja', 'noite', 'sábia', 'uhu'] },
  { id: 'porquinho', pack: 'bichos', label: 'Porquinho', tags: ['porco', 'oinc', 'rosa', 'fofo'] },
  { id: 'pinguim', pack: 'bichos', label: 'Pinguim', tags: ['pinguim', 'gelado', 'frio', 'penguin'] },
]

function urlFor(id: string): string | undefined {
  return files[`../assets/stickers/${id}.svg`]
}

export const STICKERS: Sticker[] = META.flatMap((m) => {
  const url = urlFor(m.id)
  return url ? [{ ...m, pack: m.pack ?? 'mamacos', url }] : []
})

export function stickersInPack(pack: StickerPackId): Sticker[] {
  return STICKERS.filter((s) => s.pack === pack)
}

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
