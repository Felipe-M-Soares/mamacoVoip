import type { ScreenShareSource, ScreenShareSuggestion } from '../hooks/useGamePresence'
import { setPendingGameShareHint } from './screenShareGameHint'
import { setPendingAppAudioPid } from './pendingAppAudioCapture'

// DÉCIMA QUARTA RODADA: essa lógica ("qual PID usar pra essa escolha, e
// qual recado deixar pro fechamento automático") existia só DENTRO de
// ScreenSharePicker.tsx (na função `choose`, chamada quando a pessoa
// clica num card) — sem jeito nenhum de reaproveitar em outro lugar.
// O problema real que motivou extrair isso pra cá: GameDetectedToast.tsx
// (o aviso "Jogando X! Quer compartilhar sua tela na call?") só sabia
// chamar `voice.toggleScreenShare()` puro, que SEMPRE abre o seletor
// completo de novo — do jeito que a pessoa que pediu isso relatou,
// "esse botão já devia compartilhar direto" (ela já viu o aviso dizendo
// qual jogo é, não devia precisar escolher de novo numa grade). Com essa
// função compartilhada, dá pra resolver a MESMA fonte sugerida (o
// mesmo card "Jogo" que aparece no seletor) e pular a etapa manual,
// sem duplicar a lógica de PID/áudio isolado em dois lugares (o que
// seria fácil de um lado corrigir um bug e o outro lado não).
export function pidForSourceChoice(
  id: string,
  sources: ScreenShareSource[],
  gameCard: ScreenShareSource | null,
  suggestion: ScreenShareSuggestion | null
): number | null {
  if (gameCard && id === gameCard.id) return suggestion?.pid ?? null
  return sources.find((s) => s.type === 'window' && s.id === id)?.pid ?? null
}

export function isPidExpectedForChoice(id: string, sources: ScreenShareSource[], gameCard: ScreenShareSource | null): boolean {
  if (gameCard && id === gameCard.id) return true
  return sources.some((s) => s.type === 'window' && s.id === id)
}

// Efeitos colaterais de "a pessoa escolheu esta fonte" — deixa os
// recados pendentes (fechamento automático, áudio por processo) e avisa
// o processo principal (efeito colateral de foco, ver
// ipcMain.handle('screen-share:select', ...) em electron/main.cjs).
// Quem chama ainda precisa, por conta própria, usar `id` como o
// sourceId de verdade pra capturar o vídeo (getUserMedia) — essa função
// só arma o que precisa estar pronto ANTES disso.
export function armScreenShareChoice(
  id: string,
  sources: ScreenShareSource[],
  gameCard: ScreenShareSource | null,
  suggestion: ScreenShareSuggestion | null,
  viaGameShortcut?: { processNames: string[]; label: string }
) {
  // TRIGÉSIMA SEXTA RODADA — bug relatado: transmissão não terminava
  // sozinha depois de fechar o jogo. Causa: esse `gameCard?.type ===
  // 'screen'` vinha de quando só existiam DOIS casos possíveis — uma
  // JANELA de verdade (que dispara `onended` sozinha ao fechar) ou uma
  // TELA CHEIA (que nunca "fecha" sozinha, por isso precisava vigiar o
  // processo na mão). Isso deixou de ser verdade com os fallbacks
  // nativos (WGC/GDI, ver captureNativeFallbackStream em
  // VoiceContext.tsx): quando uma fonte de JANELA falha na captura
  // normal e cai num desses fallbacks, o vídeo resultante vem de uma
  // captura do MONITOR INTEIRO via canvas — que, exatamente como a tela
  // cheia, nunca dispara `onended` sozinho quando o jogo fecha, mesmo
  // o pedido original tendo sido pra uma "janela". Como não dá pra
  // saber ANTES da captura (aqui, o pedido ainda nem foi feito) se ela
  // vai cair num fallback desses, a única forma seguro de garantir o
  // encerramento automático nos dois casos é armar a vigilância de
  // processo SEMPRE que tiver um jogo cadastrado — mesmo quando a
  // janela funcionar normal e o `onended` dela TAMBÉM disparar (as duas
  // coisas chamando stopScreenShareState() ao mesmo tempo não causa
  // problema nenhum: a segunda chamada só encontra a transmissão já
  // parada e não faz nada).
  setPendingGameShareHint(viaGameShortcut ?? null)
  setPendingAppAudioPid({
    pid: pidForSourceChoice(id, sources, gameCard, suggestion),
    isWindowChoice: isPidExpectedForChoice(id, sources, gameCard),
  })
  window.electronAPI?.selectScreenShareSource(id).catch(() => {})
}
