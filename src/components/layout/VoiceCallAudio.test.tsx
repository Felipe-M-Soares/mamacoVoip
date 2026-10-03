import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

// Só o que importa aqui: quais <RemoteAudio> são montados.
vi.mock('./CallMediaTiles', () => ({
  RemoteAudio: ({ stream, volume }: { stream: { id: string }; volume: number }) => (
    <i data-testid="audio" data-id={stream.id} data-volume={volume} />
  ),
}))

const fakeStream = (id: string) => ({ id, getAudioTracks: () => [{}] }) as unknown as MediaStream
let voiceState: Record<string, unknown>
vi.mock('../../hooks/useVoice', () => ({ useVoiceCore: () => voiceState }))

import { VoiceCallAudio } from './VoiceCallAudio'
import { hideStream, resetStreamView, showStream } from '../../lib/streamView'

beforeEach(() => {
  resetStreamView()
  voiceState = {
    connectedChannelId: 'room',
    screenSharing: false,
    deafened: false,
    masterVolume: 100,
    audioSettings: { speakerId: null },
    getParticipantVolume: () => 100,
    getScreenShareVolume: () => 100,
    participants: {
      a: { micAudioStream: fakeStream('mic-a'), screenStream: fakeStream('scr-a'), screenAudioStream: fakeStream('sa-a') },
      b: { micAudioStream: fakeStream('mic-b'), screenStream: fakeStream('scr-b'), screenAudioStream: fakeStream('sa-b') },
    },
  }
})

const ids = (c: HTMLElement) => [...c.querySelectorAll('[data-testid=audio]')].map((e) => e.getAttribute('data-id'))

describe('VoiceCallAudio', () => {
  it('transmissão fechada para de tocar som, a outra continua', () => {
    const { container, rerender } = render(<VoiceCallAudio />)
    expect(ids(container)).toEqual(['mic-a', 'mic-b', 'sa-a', 'sa-b'])
    act(() => hideStream('a'))
    rerender(<VoiceCallAudio />)
    expect(ids(container)).toEqual(['mic-a', 'mic-b', 'sa-b'])
    act(() => showStream('a'))
    rerender(<VoiceCallAudio />)
    expect(ids(container)).toEqual(['mic-a', 'mic-b', 'sa-a', 'sa-b'])
  })
  it('ensurdecido zera tudo sem mexer no volume geral', () => {
    voiceState.deafened = true
    const { container } = render(<VoiceCallAudio />)
    const vols = [...container.querySelectorAll('[data-testid=audio]')].map((e) => Number(e.getAttribute('data-volume')))
    expect(vols.every((v) => v === 0)).toBe(true)
  })
})
