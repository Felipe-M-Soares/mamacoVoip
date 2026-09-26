import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { ServerEvent } from '../types/database'

export function useServerEvents(serverId: string | null) {
  const { user } = useAuth()
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [rsvpsByEvent, setRsvpsByEvent] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setEvents([])
      setRsvpsByEvent({})
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('server_events')
      .select('*')
      .eq('server_id', serverId)
      .order('starts_at', { ascending: true })
    const list = data ?? []
    setEvents(list)

    if (list.length > 0) {
      const { data: rsvps } = await supabase
        .from('server_event_rsvps')
        .select('event_id, user_id')
        .in(
          'event_id',
          list.map((e) => e.id)
        )
      const map: Record<string, string[]> = {}
      for (const r of rsvps ?? []) {
        map[r.event_id] = [...(map[r.event_id] ?? []), r.user_id]
      }
      setRsvpsByEvent(map)
    } else {
      setRsvpsByEvent({})
    }
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createEvent(input: {
    name: string
    description: string | null
    startsAt: string
    channelId: string | null
  }): Promise<{ error: string | null }> {
    if (!serverId || !user) return { error: 'Não autenticado' }
    if (input.name.trim().length < 1) return { error: 'Digite um nome pro evento.' }
    const { error } = await supabase.from('server_events').insert({
      server_id: serverId,
      channel_id: input.channelId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      starts_at: input.startsAt,
      created_by: user.id,
    })
    if (error) return { error: error.message }
    await refresh()
    return { error: null }
  }

  async function deleteEvent(eventId: string) {
    const { error } = await supabase.from('server_events').delete().eq('id', eventId)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function toggleRsvp(eventId: string) {
    if (!user) return
    const going = rsvpsByEvent[eventId]?.includes(user.id)
    if (going) {
      await supabase.from('server_event_rsvps').delete().eq('event_id', eventId).eq('user_id', user.id)
    } else {
      await supabase.from('server_event_rsvps').insert({ event_id: eventId, user_id: user.id })
    }
    await refresh()
  }

  return { events, rsvpsByEvent, loading, createEvent, deleteEvent, toggleRsvp }
}
