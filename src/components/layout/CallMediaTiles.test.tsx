import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { RemoteAudio as RemoteAudioType } from './CallMediaTiles'

class FakeAudioContext {
  static instancesCreated = 0
  state: 'running' | 'closed' = 'running'

  constructor() {
    FakeAudioContext.instancesCreated += 1
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }

  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  }

  createMediaStreamDestination() {
    return { stream: new FakeMediaStream() }
  }

  resume() {
    return Promise.resolve()
  }

  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

class FakeMediaStream {
  getAudioTracks() {
    return [{}]
  }
}

describe('RemoteAudio', () => {
  let RemoteAudio: typeof RemoteAudioType

  afterEach(() => {
    cleanup()
  })

  beforeEach(async () => {
    FakeAudioContext.instancesCreated = 0
    // @ts-expect-error — jsdom não tem AudioContext; injeta o fake global pro teste
    global.AudioContext = FakeAudioContext
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.HTMLMediaElement.prototype as any).play = () => Promise.resolve()
    vi.resetModules()
    ;({ RemoteAudio } = await import('./CallMediaTiles'))
  })

  it('reaproveita UM ÚNICO AudioContext entre vários participantes montados ao mesmo tempo', () => {
    const streamA = new FakeMediaStream() as unknown as MediaStream
    const streamB = new FakeMediaStream() as unknown as MediaStream
    const streamC = new FakeMediaStream() as unknown as MediaStream

    render(
      <>
        <RemoteAudio stream={streamA} volume={1} />
        <RemoteAudio stream={streamB} volume={1} />
        <RemoteAudio stream={streamC} volume={1} />
      </>
    )

    expect(FakeAudioContext.instancesCreated).toBe(1)
  })

  it('não fecha o AudioContext compartilhado quando só UM participante desmonta (não silencia quem ficou)', () => {
    const streamA = new FakeMediaStream() as unknown as MediaStream
    const streamB = new FakeMediaStream() as unknown as MediaStream

    const { unmount: unmountA } = render(<RemoteAudio stream={streamA} volume={1} />)
    render(<RemoteAudio stream={streamB} volume={1} />)

    expect(FakeAudioContext.instancesCreated).toBe(1)

    unmountA()

    render(<RemoteAudio stream={new FakeMediaStream() as unknown as MediaStream} volume={1} />)
    expect(FakeAudioContext.instancesCreated).toBe(1)
  })
})
