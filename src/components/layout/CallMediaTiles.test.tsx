import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { RemoteAudio as RemoteAudioType } from './CallMediaTiles'

// jsdom não implementa Web Audio de verdade — simula só o suficiente
// pra observar quantas instâncias de AudioContext o componente cria.
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
    // jsdom não implementa reprodução de mídia — sem isso, o <audio autoPlay>
    // renderizado pelo componente lança "not implemented" no console.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.HTMLMediaElement.prototype as any).play = () => Promise.resolve()
    // O AudioContext compartilhado (getSharedRemoteAudioContext) vive
    // como variável de módulo — reimporta o módulo do zero a cada teste
    // pra cada um começar sem nenhum contexto ainda criado, em vez de
    // reaproveitar o do teste anterior (o que é o comportamento CORRETO
    // em produção, só atrapalha o isolamento entre testes aqui).
    vi.resetModules()
    ;({ RemoteAudio } = await import('./CallMediaTiles'))
  })

  it('reaproveita UM ÚNICO AudioContext entre vários participantes montados ao mesmo tempo', () => {
    // BUG REAL corrigido: antes, cada <RemoteAudio> criava o SEU
    // PRÓPRIO `new AudioContext()` — numa sala com vários participantes,
    // isso abria um contexto de áudio por pessoa, o que em alguns
    // sistemas faz o Chromium simplesmente parar de tocar áudio depois
    // de um punhado de contextos simultâneos. Com a correção, não
    // importa quantos <RemoteAudio> estejam montados ao mesmo tempo —
    // só UM AudioContext deve ser criado no total.
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

    // O contexto compartilhado continua "running" — desmontar um
    // participante não pode fechar o áudio de quem continua na call.
    // (Se estivesse fechando, a próxima instância criada bateria
    // instancesCreated pra 2 — ver getSharedRemoteAudioContext.)
    render(<RemoteAudio stream={new FakeMediaStream() as unknown as MediaStream} volume={1} />)
    expect(FakeAudioContext.instancesCreated).toBe(1)
  })
})
