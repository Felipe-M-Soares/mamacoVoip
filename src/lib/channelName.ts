import type { Channel, ChannelType } from '../types/database'

// Canal de TEXTO: "novo-canal" (minúsculas, hífen no lugar de espaço).
// Sala de VOZ: mantém o nome como foi digitado ("Caçando monstro", "RANKED").
export function channelNameFor(type: ChannelType, raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, 100)
  return type === 'text' ? trimmed.toLowerCase().replace(/\s/g, '-') : trimmed
}

/**
 * Ordem da lista de canais: os de texto primeiro, depois as salas de voz
 * (cada grupo na ordem escolhida pelo admin).
 */
export function orderChannels<T extends Pick<Channel, 'type' | 'position'>>(list: T[]): { text: T[]; voice: T[] } {
  const byPos = (a: T, b: T) => a.position - b.position
  return {
    text: list.filter((c) => c.type !== 'voice').sort(byPos),
    voice: list.filter((c) => c.type === 'voice').sort(byPos),
  }
}
