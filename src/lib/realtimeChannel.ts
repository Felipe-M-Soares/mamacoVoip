import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js'
import { supabase } from './supabase'

export async function ensureRealtimeAuth(): Promise<void> {
  try {
    await supabase.realtime.setAuth()
  } catch {
  }
}

export function privateChannelParams(params: RealtimeChannelOptions = { config: {} }): RealtimeChannelOptions {
  return { ...params, config: { ...(params.config ?? {}), private: true } }
}

export const CHANGES_TOPIC_PREFIX = 'pgc:'

export function uniqueTopic(base: string): string {
  return `${CHANGES_TOPIC_PREFIX}${base}:${Math.random().toString(36).slice(2)}`
}

export function changesChannel(name: string): RealtimeChannel {
  const channel = supabase.channel(uniqueTopic(name), privateChannelParams())
  const originalSubscribe = channel.subscribe.bind(channel)
  channel.subscribe = ((...args: Parameters<RealtimeChannel['subscribe']>) => {
    void ensureRealtimeAuth().finally(() => {
      if (!supabase.getChannels().includes(channel)) return
      originalSubscribe(...args)
    })
    return channel
  }) as RealtimeChannel['subscribe']
  return channel
}

export function openSharedChannel(
  topic: string,
  params: RealtimeChannelOptions,
  setup: (channel: RealtimeChannel) => void
): () => void {
  let cancelled = false
  let channel: RealtimeChannel | null = null

  const start = () => {
    if (cancelled) return
    channel = supabase.channel(topic, privateChannelParams(params))
    setup(channel)
  }

  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
  const removeStale = stale
    ? supabase.removeChannel(stale).catch(() => {
      })
    : Promise.resolve()
  void Promise.all([removeStale, ensureRealtimeAuth()]).finally(start)

  return () => {
    cancelled = true
    if (channel) void supabase.removeChannel(channel)
  }
}
