import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pidForSourceChoice, isPidExpectedForChoice, armScreenShareChoice } from './chooseScreenShareSource'
import { takePendingGameShareHint } from './screenShareGameHint'
import { takePendingAppAudioPid } from './pendingAppAudioCapture'
import type { ScreenShareSource, ScreenShareSuggestion } from '../hooks/useGamePresence'

const windowSource: ScreenShareSource = {
  id: 'window-1',
  name: 'Rainbow Six Siege',
  thumbnail: '',
  type: 'window',
  pid: 4242,
}

const windowSourceNoPid: ScreenShareSource = {
  id: 'window-2',
  name: 'Bloco de notas',
  thumbnail: '',
  type: 'window',
}

const screenSource: ScreenShareSource = {
  id: 'screen-1',
  name: 'Tela inteira',
  thumbnail: '',
  type: 'screen',
}

const gameCardAsScreen: ScreenShareSource = {
  id: 'screen-1',
  name: 'Jogo (tela cheia)',
  thumbnail: '',
  type: 'screen',
  isGameDisplay: true,
}

const suggestion: ScreenShareSuggestion = {
  label: 'Rainbow Six Siege',
  isKnownGame: true,
  processNames: ['RainbowSix.exe'],
  pid: 9999,
}

const sources = [windowSource, windowSourceNoPid, screenSource]

describe('pidForSourceChoice', () => {
  it('usa o pid da SUGESTÃO quando a escolha é o próprio card do jogo', () => {
    expect(pidForSourceChoice(gameCardAsScreen.id, sources, gameCardAsScreen, suggestion)).toBe(9999)
  })

  it('devolve null quando a escolha é o gameCard mas não há sugestão (pid ausente)', () => {
    expect(pidForSourceChoice(gameCardAsScreen.id, sources, gameCardAsScreen, null)).toBeNull()
  })

  it('usa o pid da própria fonte quando é uma janela normal', () => {
    expect(pidForSourceChoice('window-1', sources, null, null)).toBe(4242)
  })

  it('devolve null quando a janela escolhida não tem pid resolvido', () => {
    expect(pidForSourceChoice('window-2', sources, null, null)).toBeNull()
  })

  it('devolve null quando a escolha é uma TELA (não janela, não é o gameCard)', () => {
    expect(pidForSourceChoice('screen-1', sources, null, null)).toBeNull()
  })

  it('devolve null quando o id não bate com nenhuma fonte conhecida', () => {
    expect(pidForSourceChoice('id-desconhecido', sources, null, null)).toBeNull()
  })
})

describe('isPidExpectedForChoice', () => {
  it('é true quando a escolha é o gameCard', () => {
    expect(isPidExpectedForChoice(gameCardAsScreen.id, sources, gameCardAsScreen)).toBe(true)
  })

  it('é true pra qualquer janela normal, mesmo sem pid resolvido', () => {
    expect(isPidExpectedForChoice('window-2', sources, null)).toBe(true)
  })

  it('é false pra uma tela que não é o gameCard', () => {
    expect(isPidExpectedForChoice('screen-1', sources, null)).toBe(false)
  })

  it('é false pra um id desconhecido', () => {
    expect(isPidExpectedForChoice('id-desconhecido', sources, null)).toBe(false)
  })
})

describe('armScreenShareChoice', () => {
  beforeEach(() => {
    // limpa qualquer recado deixado por um teste anterior
    takePendingGameShareHint()
    takePendingAppAudioPid()
    // @ts-expect-error só nos testes — window.electronAPI normalmente só existe dentro do app empacotado
    window.electronAPI = { selectScreenShareSource: vi.fn().mockResolvedValue(undefined) }
  })

  it('deixa o recado de PID pra uma janela normal e chama selectScreenShareSource com o id certo', () => {
    armScreenShareChoice('window-1', sources, null, null)
    expect(takePendingAppAudioPid()).toEqual({ pid: 4242, isWindowChoice: true })
    expect(takePendingGameShareHint()).toBeNull()
    expect(window.electronAPI?.selectScreenShareSource).toHaveBeenCalledWith('window-1')
  })

  it('deixa o recado de fechamento automático quando o gameCard é TELA CHEIA e veio via atalho do jogo', () => {
    const viaGameShortcut = { processNames: suggestion.processNames, label: suggestion.label }
    armScreenShareChoice(gameCardAsScreen.id, sources, gameCardAsScreen, suggestion, viaGameShortcut)
    expect(takePendingGameShareHint()).toEqual(viaGameShortcut)
    expect(takePendingAppAudioPid()).toEqual({ pid: 9999, isWindowChoice: true })
  })

  it('NÃO deixa recado de fechamento automático quando o gameCard é uma JANELA (já fecha sozinha)', () => {
    const gameCardAsWindow: ScreenShareSource = { ...windowSource, id: 'window-1' }
    const viaGameShortcut = { processNames: suggestion.processNames, label: suggestion.label }
    armScreenShareChoice('window-1', sources, gameCardAsWindow, suggestion, viaGameShortcut)
    expect(takePendingGameShareHint()).toBeNull()
  })

  it('não quebra quando window.electronAPI não existe (fora do Electron)', () => {
    // simula ambiente sem o preload do Electron — a própria propriedade é opcional, sem precisar de ts-expect-error
    window.electronAPI = undefined
    expect(() => armScreenShareChoice('window-1', sources, null, null)).not.toThrow()
  })
})
