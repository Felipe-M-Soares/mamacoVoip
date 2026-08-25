import { useEffect, useState } from 'react'
import type { ScreenShareSource, ScreenShareSuggestion } from '../../hooks/useGamePresence'
import { setPendingGameShareHint } from '../../lib/screenShareGameHint'
import { setPendingAppAudioPid } from '../../lib/pendingAppAudioCapture'
import { QUALITY_PRESETS, loadQuality } from '../../hooks/useScreenShareQuality'

// Versão enxuta: só o essencial — as fontes agrupadas por categoria
// (Jogo / Tela cheia / Janela) e os dois controles que realmente mudam
// o que vai ser compartilhado (áudio do sistema, cancelar). Sem parágrafo
// de explicação por card — a categoria já diz o que é.
//
// A sugestão (`suggestion`, calculada no processo principal — ver
// electron/main.cjs) diferencia dois casos: jogo CADASTRADO (KNOWN_GAMES,
// `isKnownGame: true`) ganha a própria categoria "Jogo" em destaque;
// qualquer outra janela sugerida (a última em primeiro plano antes de
// abrir esse seletor, não necessariamente um jogo) só recebe um contorno
// discreto dentro de "Janela", sem virar uma seção própria — não dá pra
// saber com certeza que é um jogo, então não afirma isso na cara da
// pessoa.
export function ScreenSharePicker() {
  const [sources, setSources] = useState<ScreenShareSource[] | null>(null)
  const [suggestion, setSuggestion] = useState<ScreenShareSuggestion | null>(null)
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false)
  // EXPERIMENTAL — ver pendingAppAudioCapture.ts e o bloco grande em
  // electron/main.cjs ("Captura de áudio por processo"). Só faz sentido
  // pra Jogo/Janela (que têm PID resolvido); telas inteiras continuam
  // usando o checkbox de áudio do sistema acima.
  const [useAppAudio, setUseAppAudio] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.onScreenShareSources((payload) => {
      setSources(payload.sources)
      setSuggestion(payload.suggestion)
    })
  }, [])

  if (!sources) return null

  const suggestedSource = sources.find((s) => s.isExactGameWindow) ?? null
  const gameCard = suggestion?.isKnownGame ? suggestedSource : null
  const screens = sources.filter((s) => s.type === 'screen')
  const windows = sources.filter((s) => s.type === 'window' && s !== gameCard)

  const currentQualityPreset = QUALITY_PRESETS[loadQuality()]

  // PID resolvido pra cada escolha possível — Jogo usa o PID vindo da
  // sugestão (windowInfo.pid, cobre inclusive o fallback de tela cheia);
  // qualquer Janela usa o próprio source.pid (mapa por título, ver
  // getWindowPidMap em electron/main.cjs). Telas inteiras nunca têm PID
  // (podem ter vários processos desenhando nela), então a opção "áudio só
  // deste app" nunca se aplica a elas.
  function pidForChoice(id: string | null): number | null {
    if (!id) return null
    if (gameCard && id === gameCard.id) return suggestion?.pid ?? null
    return windows.find((w) => w.id === id)?.pid ?? null
  }
  const anyPidAvailable = Boolean((gameCard && suggestion?.pid) || windows.some((w) => w.pid))

  function choose(id: string | null, viaGameShortcut?: { processNames: string[]; label: string }) {
    // O recado só faz sentido pro atalho "Jogo" caindo no fallback de
    // TELA CHEIA (sem janela própria pra detectar o fechamento sozinha —
    // ver screenShareGameHint.ts). Qualquer outra escolha (grade normal)
    // limpa esse recado, defensivo — evita um auto-stop errado "vazando"
    // pra uma captura sem relação com ele.
    setPendingGameShareHint(viaGameShortcut && gameCard?.type === 'screen' ? viaGameShortcut : null)
    setPendingAppAudioPid(useAppAudio ? pidForChoice(id) : null)
    window.electronAPI?.selectScreenShareSource(id, includeSystemAudio).catch(() => {})
    setSources(null)
  }

  return (
    <div
      className="fixed inset-0 z-[400] bg-black/70 flex items-center justify-center p-4"
      onClick={() => choose(null)}
    >
      <div
        className="bg-discord-dark rounded-lg shadow-2xl max-w-2xl w-full p-5 border border-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="font-display text-lg font-bold text-white tracking-wide">Escolha o que compartilhar</h2>
          <span className="text-[10px] text-discord-text-muted shrink-0">{currentQualityPreset.label}</span>
        </div>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={includeSystemAudio}
            onChange={(e) => setIncludeSystemAudio(e.target.checked)}
            className="accent-discord-blurple"
          />
          <span className="text-xs text-discord-text">Compartilhar áudio do sistema (só tela inteira)</span>
        </label>

        {anyPidAvailable && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={useAppAudio}
              onChange={(e) => setUseAppAudio(e.target.checked)}
              className="accent-discord-blurple"
            />
            <span className="text-xs text-discord-text">
              Capturar áudio só deste app (experimental — ao escolher "Jogo" ou uma janela)
            </span>
          </label>
        )}

        <div className="max-h-[55vh] overflow-y-auto pr-1 space-y-4">
          {gameCard && suggestion && (
            <SourceSection title="Jogo">
              <SourceCard
                source={gameCard}
                highlighted
                onClick={() => choose(gameCard.id, { processNames: suggestion.processNames, label: suggestion.label })}
              />
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
                <SourceCard key={s.id} source={s} highlighted={s === suggestedSource} onClick={() => choose(s.id)} />
              ))}
            </SourceSection>
          )}
        </div>

        {/* Único lembrete que sobrou — é a única explicação que muda o
            que a pessoa faria (ir nas configurações do jogo), o resto
            já dá pra entender só olhando a lista categorizada acima. */}
        <p className="text-[10px] text-discord-text-muted mt-3">
          Jogo não aparece como janela? Troque pra "tela cheia sem bordas" nas configurações dele.
        </p>

        <button onClick={() => choose(null)} className="mt-3 w-full py-2.5 rounded btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function SourceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-discord-text-muted tracking-wide mb-1.5">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
    </div>
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
      className={`text-left rounded-lg overflow-hidden border-2 transition-colors bg-discord-darker ${
        highlighted ? 'border-discord-blurple' : 'border-transparent hover:border-discord-blurple'
      }`}
    >
      <img src={source.thumbnail} alt={source.name} className="w-full aspect-video object-cover bg-black" />
      <p className="text-xs text-discord-text px-2 py-1.5 truncate">{source.name}</p>
    </button>
  )
}
