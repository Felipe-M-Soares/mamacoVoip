import type { Channel, ChannelType } from '../types/database'

export function channelNameFor(type: ChannelType, raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, 100)
  return type === 'text' ? trimmed.toLowerCase().replace(/\s/g, '-') : trimmed
}

export function orderChannels<T extends Pick<Channel, 'type' | 'position'>>(list: T[]): { text: T[]; voice: T[] } {
  const byPos = (a: T, b: T) => a.position - b.position
  return {
    text: list.filter((c) => c.type !== 'voice').sort(byPos),
    voice: list.filter((c) => c.type === 'voice').sort(byPos),
  }
}
