import type { ScreenShareSource, ScreenShareSuggestion } from '../hooks/useGamePresence'
import { setPendingGameShareHint } from './screenShareGameHint'
import { setPendingAppAudioPid } from './pendingAppAudioCapture'

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

export function armScreenShareChoice(
  id: string,
  sources: ScreenShareSource[],
  gameCard: ScreenShareSource | null,
  suggestion: ScreenShareSuggestion | null,
  viaGameShortcut?: { processNames: string[]; label: string }
) {
  setPendingGameShareHint(viaGameShortcut ?? null)
  setPendingAppAudioPid({
    pid: pidForSourceChoice(id, sources, gameCard, suggestion),
    isWindowChoice: isPidExpectedForChoice(id, sources, gameCard),
  })
  window.electronAPI?.selectScreenShareSource(id).catch(() => {})
}
