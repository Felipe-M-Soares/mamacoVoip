import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useVoicePresence } from './useVoicePresence'

interface FakeChannel {
  topic: string
  state: string
  on: (type: string, filter: unknown, callback: () => void) => FakeChannel
  subscribe: () => FakeChannel
  presenceState: () => Record<string, unknown>
}

function createFakeSupabase() {
  const registered: FakeChannel[] = []

  const channel = vi.fn((topic: string): FakeChannel => {
    const fullTopic = `realtime:${topic}`
    const existing = registered.find((c) => c.topic === fullTopic)
    if (existing) return existing

    const chan: FakeChannel = {
      topic: fullTopic,
      state: 'closed',
      on: vi.fn((): FakeChannel => {
        if (chan.state === 'joined' || chan.state === 'joining') {
          throw new Error(`cannot add \`presence\` callbacks for ${topic} after \`subscribe()\`.`)
        }
        return chan
      }),
      subscribe: vi.fn((): FakeChannel => {
        chan.state = 'joined'
        return chan
      }),
      presenceState: vi.fn(() => ({})),
    }
    registered.push(chan)
    return chan
  })

  const getChannels = vi.fn(() => registered)
  const removeChannel = vi.fn((chan: FakeChannel) => {
    chan.state = 'closed'
    const idx = registered.indexOf(chan)
    if (idx >= 0) registered.splice(idx, 1)
  })

  return { channel, getChannels, removeChannel, registered }
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: (...args: unknown[]) => fakeSupabase.channel(...(args as [string])),
    getChannels: () => fakeSupabase.getChannels(),
    removeChannel: (...args: unknown[]) => fakeSupabase.removeChannel(...(args as [never])),
  },
}))

let fakeSupabase: ReturnType<typeof createFakeSupabase>

describe('useVoicePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeSupabase = createFakeSupabase()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('não lança/derruba o app quando o tópico já está ocupado por um canal ainda assinado (corrida do leave())', async () => {
    const staleChannel = fakeSupabase.channel('voice:room-1')
    staleChannel.subscribe()
    expect(staleChannel.state).toBe('joined')

    const { result, unmount } = renderHook(() => useVoicePresence('room-1', false))

    expect(staleChannel.on).not.toHaveBeenCalled()
    expect(result.current).toEqual([])

    act(() => {
      fakeSupabase.removeChannel(staleChannel)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    const newChannel = fakeSupabase.registered.find((c) => c.topic === 'realtime:voice:room-1')
    expect(newChannel).toBeDefined()
    expect(newChannel!.on).toHaveBeenCalled()
    expect(newChannel!.subscribe).toHaveBeenCalled()

    unmount()
  })

  it('se inscreve direto quando não há corrida (tópico livre)', async () => {
    vi.useRealTimers()
    renderHook(() => useVoicePresence('room-2', false))

    await waitFor(() => {
      const chan = fakeSupabase.registered.find((c) => c.topic === 'realtime:voice:room-2')
      expect(chan).toBeDefined()
      expect(chan!.on).toHaveBeenCalled()
      expect(chan!.subscribe).toHaveBeenCalled()
    })
  })

  it('não se inscreve quando skip é true', () => {
    renderHook(() => useVoicePresence('room-3', true))
    expect(fakeSupabase.channel).not.toHaveBeenCalled()
  })
})
