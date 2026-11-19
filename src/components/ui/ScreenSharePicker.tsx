import { useEffect, useState } from 'react'
import type { ScreenShareSource, ScreenShareSuggestion } from '../../hooks/useGamePresence'
import { setPendingGameShareHint } from '../../lib/screenShareGameHint'
import { setPendingAppAudioPid } from '../../lib/pendingAppAudioCapture'
import { subscribeScreenSharePicker, resolveScreenSharePicker } from '../../lib/screenSharePickerBridge'
import { buildGamePreset, loadGameAutoPreset, loadQualityPreset } from '../../hooks/useScreenShareQuality'
import { armScreenShareChoice } from '../../lib/chooseScreenShareSource'

export function ScreenSharePicker() {
  const [sources, setSources] = useState<ScreenShareSource[] | null>(null)
  const [suggestion, setSuggestion] = useState<ScreenShareSuggestion | null>(null)

  useEffect(() => {
    return subscribeScreenSharePicker((payload) => {
      setSources(payload?.sources ?? null)
      setSuggestion(payload?.suggestion ?? null)
    })
  }, [])

  const isOpen = sources !== null
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setPendingGameShareHint(null)
      setPendingAppAudioPid(null)
      resolveScreenSharePicker(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  if (!sources) return null
  const confirmedSources: ScreenShareSource[] = sources

  const suggestedSource = sources.find((s) => s.isExactGameWindow) ?? sources.find((s) => s.isGameDisplay) ?? null
  const gameCard = suggestion ? suggestedSource : null
  const gameCardTitle = suggestion?.isKnownGame ? 'Jogo' : 'Sugestão'
  const screens = sources.filter((s) => s.type === 'screen' && s !== gameCard)
  const windows = sources.filter((s) => s.type === 'window' && s !== gameCard)

  const currentQualityPreset = loadQualityPreset()
  const gamePresetLabel =
    suggestion?.isKnownGame && loadGameAutoPreset()
      ? buildGamePreset(currentQualityPreset, { weakNetwork: false }).label
      : null

  function choose(id: string | null, viaGameShortcut?: { processNames: string[]; label: string }) {
    if (id) {
      armScreenShareChoice(id, confirmedSources, gameCard, suggestion, viaGameShortcut)
    } else {
      setPendingGameShareHint(null)
      setPendingAppAudioPid(null)
    }
    resolveScreenSharePicker(id)
  }

  return (
    <div
      className="fixed inset-0 z-[400] bg-black/75 flex items-center justify-center p-4 animate-fade-in"
      onClick={() => choose(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-share-picker-title"
        className="surface-elevated rounded-2xl max-w-2xl w-full p-5 sm:p-6 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-mv-accent/15 text-mv-accent ring-1 ring-inset ring-mv-accent/25 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
                <path d="M4 4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5l-1 3h8l-1-3h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm0 2h16v9H4V6z" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2
                id="screen-share-picker-title"
                className="font-display text-lg font-semibold text-white leading-tight"
              >
                Escolha o que compartilhar
              </h2>
              <p className="text-[12px] text-mv-muted">O áudio é escolhido sozinho conforme a fonte.</p>
            </div>
          </div>
          <span className="chip shrink-0" title="Qualidade da transmissão">
            {currentQualityPreset.label}
          </span>
        </div>

        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 pb-1 space-y-5">
          {gameCard && suggestion && (
            <SourceSection title={gameCardTitle}>
              <SourceCard
                source={{ ...gameCard, name: suggestion.label }}
                highlighted
                onClick={() =>
                  choose(gameCard.id, {
                    processNames: suggestion.processNames,
                    label: suggestion.label,
                  })
                }
              />
              {gameCard.type === 'screen' && (
                <p className="col-span-2 sm:col-span-3 text-[11px] leading-snug text-mv-muted -mt-1">
                  A miniatura pode não corresponder ao jogo (o Windows não gera preview de tela cheia exclusiva) —
                  clicar aqui compartilha o jogo de verdade mesmo assim.
                </p>
              )}
              {(gamePresetLabel || suggestion.antiCheat) && (
                <div className="col-span-2 sm:col-span-3 -mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-mv-muted">
                  {gamePresetLabel && (
                    <span
                      className="chip"
                      title="Qualidade automática para jogos — dá pra desligar em Configurações de transmissão"
                    >
                      {gamePresetLabel}
                    </span>
                  )}
                  {suggestion.antiCheat && (
                    <span
                      title={`${suggestion.label} usa ${suggestion.antiCheat}. O Mamacos Voip não injeta nada no jogo: a captura usa a API oficial do Windows, então é seguro. Pra sobreposição aparecer por cima, deixe o jogo em "janela sem borda".`}
                    >
                      Anti-cheat {suggestion.antiCheat}: captura segura, sem injeção no jogo.
                    </span>
                  )}
                </div>
              )}
            </SourceSection>
          )}
          {screens.length > 0 && (
            <SourceSection title="Tela cheia">
              {screens.map((s) => (
                <SourceCard key={s.id} source={s} onClick={() => choose(s.id)} />
              ))}
            </SourceSection>
          )}
          {windows.length > 0 && (
            <SourceSection title="Janela">
              {windows.map((s) => (
                <SourceCard key={s.id} source={s} onClick={() => choose(s.id)} />
              ))}
            </SourceSection>
          )}
        </div>

        <div className="mt-4 flex gap-2.5 rounded-xl bg-white/[0.03] border border-[var(--color-line)] px-3 py-2.5">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="w-4 h-4 text-mv-muted shrink-0 mt-px"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          <div className="space-y-1 text-[11px] leading-snug text-mv-muted">
            <p>Jogo não aparece como janela? Troque pra "tela cheia sem bordas" nas configurações dele.</p>
            <p>
              Não vê a janela que procura? Ela pode estar minimizada — o Windows só mostra aqui janelas abertas e
              visíveis (restaure a janela e tente de novo).
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={() => choose(null)} className="h-10 px-5 btn-secondary text-[14px]">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function SourceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted mb-2">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
    </section>
  )
}

function SourceCard({
  source,
  highlighted,
  onClick,
}: {
  source: ScreenShareSource
  highlighted?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={source.name}
      className={`group text-left rounded-xl overflow-hidden border bg-mv-canvas transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 ${
        highlighted
          ? 'border-mv-accent shadow-[0_0_0_1px_var(--color-mv-accent),0_10px_28px_-12px_var(--color-mv-accent)]'
          : 'border-[var(--color-line)] hover:border-mv-accent/60 hover:shadow-[0_10px_28px_-14px_rgb(0_0_0/0.9)]'
      }`}
    >
      <div className="relative">
        {source.thumbnail ? (
          <img src={source.thumbnail} alt={source.name} className="w-full aspect-video object-cover bg-black" />
        ) : (
          <div className="w-full aspect-video bg-black" aria-hidden />
        )}
        <span className="absolute inset-0 bg-mv-accent/0 group-hover:bg-mv-accent/10 transition-colors" aria-hidden />
        {highlighted && (
          <span className="absolute top-2 left-2 chip !bg-mv-accent !text-white !border-transparent">Recomendado</span>
        )}
      </div>
      <p className="text-[12px] font-medium text-mv-text px-2.5 py-2 truncate">{source.name}</p>
    </button>
  )
}
