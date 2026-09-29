import { describe, expect, it, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useSplitVoiceValue, useVoiceSpeaking, VoiceActivityContext } from './voiceSplit'
import type { VoiceContextValue, VoiceParticipant } from './VoiceContext'

function participant(userId: string, speaking = false): VoiceParticipant {
  return { userId, speaking, cameraStream: null, screenStream: null, micAudioStream: null, screenAudioStream: null }
}

// Estados do provider (useState) mantêm a identidade entre renders.
const NO_QUALITY = {}
const NO_PARTICIPANTS = {}

// Valor "cru" como o VoiceProvider monta: objeto e funções novos a cada render.
function raw(over: Partial<VoiceContextValue> = {}): VoiceContextValue {
  return {
    connectedChannelId: 'c1',
    muted: false,
    speaking: false,
    participants: NO_PARTICIPANTS,
    connectionQuality: NO_QUALITY,
    localConnectionQuality: null,
    join: async () => {},
    leave: () => {},
    audioSettings: { micId: null, setMicId: () => {} },
    screenShareQuality: { preset: { width: 1920, height: 1080, frameRate: 30 }, setResolution: () => {} },
    ...over,
  } as unknown as VoiceContextValue
}

describe('useSplitVoiceValue', () => {
  it('mantém o "core" estável quando só quem-está-falando muda', () => {
    const a = participant('u2')
    const people = { u2: a }
    const { result, rerender } = renderHook(({ v }) => useSplitVoiceValue(v, 'me', 0), {
      initialProps: { v: raw({ participants: people }) },
    })
    const core1 = result.current.core
    const full1 = result.current.full

    // re-render sem mudança nenhuma (funções recriadas): nada muda
    rerender({ v: raw({ participants: people }) })
    expect(result.current.core).toBe(core1)
    expect(result.current.full).toBe(full1)

    // alguém começou a falar / eu comecei a falar / qualidade mudou
    rerender({ v: raw({ participants: { u2: { ...a, speaking: true } }, speaking: true, connectionQuality: { u2: 'good' } }) })
    expect(result.current.core).toBe(core1)
    expect(result.current.full).not.toBe(full1)
    expect(result.current.full.participants.u2.speaking).toBe(true)
    expect(result.current.full.speaking).toBe(true)

    // mudança "de verdade" (mutou): core novo
    rerender({ v: raw({ participants: { u2: a }, muted: true }) })
    expect(result.current.core).not.toBe(core1)
    expect(result.current.core.muted).toBe(true)
  })

  it('funções do core chamam sempre a versão mais recente', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ v }) => useSplitVoiceValue(v, 'me', 0), {
      initialProps: { v: raw({ leave: first }) },
    })
    const leave = result.current.core.leave
    rerender({ v: raw({ leave: second }) })
    expect(result.current.core.leave).toBe(leave)
    leave()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('useVoiceSpeaking re-renderiza só o avatar de quem mudou', () => {
    let store: ReturnType<typeof useSplitVoiceValue>['store'] | null = null
    const renders: Record<string, number> = { me: 0, u2: 0, u3: 0 }
    function Dot({ id }: { id: string }) {
      const speaking = useVoiceSpeaking(id)
      renders[id]++
      return <span data-testid={id}>{speaking ? 'on' : 'off'}</span>
    }
    function Harness({ v, children }: { v: VoiceContextValue; children: ReactNode }) {
      const split = useSplitVoiceValue(v, 'me', 0)
      store = split.store
      return <VoiceActivityContext.Provider value={split.store}>{children}</VoiceActivityContext.Provider>
    }
    const dots = (
      <>
        <Dot id="me" />
        <Dot id="u2" />
        <Dot id="u3" />
      </>
    )
    const p = { u2: participant('u2'), u3: participant('u3') }
    const view = render(<Harness v={raw({ participants: p })}>{dots}</Harness>)
    expect(store).not.toBeNull()
    const before = { ...renders }
    act(() => {
      view.rerender(<Harness v={raw({ participants: { ...p, u2: participant('u2', true) } })}>{dots}</Harness>)
    })
    expect(view.getByTestId('u2').textContent).toBe('on')
    expect(renders.u2).toBeGreaterThan(before.u2)
    expect(renders.u3).toBe(before.u3)
    expect(renders.me).toBe(before.me)

    act(() => {
      view.rerender(<Harness v={raw({ participants: { ...p, u2: participant('u2', true) }, speaking: true })}>{dots}</Harness>)
    })
    expect(view.getByTestId('me').textContent).toBe('on')
  })
})
