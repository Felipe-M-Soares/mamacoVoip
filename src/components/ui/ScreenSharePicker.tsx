import { useEffect, useState } from 'react'
import type { ScreenShareSource, ScreenShareSuggestion } from '../../hooks/useGamePresence'
import { setPendingGameShareHint } from '../../lib/screenShareGameHint'
import { setPendingAppAudioPid } from '../../lib/pendingAppAudioCapture'
import { QUALITY_PRESETS, loadQuality } from '../../hooks/useScreenShareQuality'

// Versão enxuta: só o essencial — as fontes agrupadas por categoria
// (Jogo / Tela cheia / Janela). Sem parágrafo de explicação por card — a
// categoria já diz o que é, e sem checkbox de áudio nenhum: o áudio agora
// é escolhido SOZINHO conforme o tipo da fonte (pedido explícito — "se for
// janela captura audio da janela se for tela cheia captura tela cheia
// automatico"):
//   - Janela (ou "Jogo" quando resolve pra uma janela de verdade) → tenta
//     capturar o áudio só DAQUELE app (ver pidForChoice abaixo e a seção
//     "Captura de áudio por processo" em electron/main.cjs). Se não der
//     (fora do Windows, PID não resolvido, falha da API), a transmissão
//     simplesmente segue sem áudio — nunca trava por causa disso.
//   - Tela cheia (ou "Jogo" caindo no fallback de tela cheia) → áudio do
//     sistema (loopback) ligado direto, sem precisar marcar nada (ver
//     ipcMain.handle('screen-share:select', ...) em electron/main.cjs).
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
  // sugestão (windowInfo.pid, só quando esse "Jogo" é mesmo uma JANELA —
  // ver abaixo); qualquer Janela usa o próprio source.pid (mapa por
  // título, ver getWindowPidMap em electron/main.cjs). Telas inteiras
  // nunca têm PID (podem ter vários processos desenhando nela) — pra
  // essas, o áudio automático é sempre o do sistema (ver
  // ipcMain.handle('screen-share:select', ...) em electron/main.cjs), não
  // captura por processo.
  function pidForChoice(id: string | null): number | null {
    if (!id) return null
    if (gameCard && id === gameCard.id && gameCard.type === 'window') return suggestion?.pid ?? null
    return windows.find((w) => w.id === id)?.pid ?? null
  }

  function choose(id: string | null, viaGameShortcut?: { processNames: string[]; label: string }) {
    // O recado só faz sentido pro atalho "Jogo" caindo no fallback de
    // TELA CHEIA (sem janela própria pra detectar o fechamento sozinha —
    // ver screenShareGameHint.ts). Qualquer outra escolha (grade normal)
    // limpa esse recado, defensivo — evita um auto-stop errado "vazando"
    // pra uma captura sem relação com ele.
    setPendingGameShareHint(viaGameShortcut && gameCard?.type === 'screen' ? viaGameShortcut : null)
    // Automático, sem checkbox nenhum: se der pra saber o processo dono
    // da janela escolhida, tenta capturar o áudio só dele — senão (tela
    // cheia, ou não deu pra descobrir o PID), fica por conta do áudio de
    // sistema automático que electron/main.cjs já liga sozinho pra
    // qualquer escolha de tela cheia.
    setPendingAppAudioPid(pidForChoice(id))
    window.electronAPI?.selectScreenShareSource(id).catch(() => {})
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
