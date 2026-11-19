import type { RealtimeChannel } from '@supabase/supabase-js'
import { openSharedChannel } from '../lib/realtimeChannel'

export interface KartRacer { id: string; name: string; skin?: Record<string, unknown> | null }
export interface KartNet {
  me: string
  racers: KartRacer[]
  send: (type: string, d: Record<string, unknown>) => void
  on: (h: (from: string, type: string, d: Record<string, unknown>) => void) => () => void
  close: () => void
}

export function openKartNet(serverId: string, raceId: string, me: string, racers: KartRacer[]): KartNet {
  const handlers = new Set<(from: string, type: string, d: Record<string, unknown>) => void>()
  const ids = new Set(racers.map((r) => r.id))
  let channel: RealtimeChannel | null = null
  let ready = false
  const queue: [string, Record<string, unknown>][] = []
  const close = openSharedChannel(`kart:${serverId}`, { config: { broadcast: { self: false } } }, (rt) => {
    rt.on('broadcast', { event: 'k' }, ({ payload }) => {
      const p = payload as { race?: string; from?: string; type?: string; d?: Record<string, unknown> } | undefined
      if (!p || p.race !== raceId || typeof p.from !== 'string' || !ids.has(p.from) || p.from === me || typeof p.type !== 'string') return
      for (const h of handlers) h(p.from, p.type, p.d ?? {})
    })
    rt.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ready = true
        for (const [t, d] of queue.splice(0)) void rt.send({ type: 'broadcast', event: 'k', payload: { race: raceId, from: me, type: t, d } })
      }
    })
    channel = rt
  })
  return {
    me,
    racers,
    send(type, d) {
      if (!channel || !ready) { if (type !== 's') queue.push([type, d]); return }
      void channel.send({ type: 'broadcast', event: 'k', payload: { race: raceId, from: me, type, d } })
    },
    on(h) {
      handlers.add(h)
      return () => handlers.delete(h)
    },
    close() {
      handlers.clear()
      close()
    },
  }
}
