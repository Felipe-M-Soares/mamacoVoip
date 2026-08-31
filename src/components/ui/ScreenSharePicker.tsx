import { useEffect, useState } from 'react'
import type { ScreenShareSource, ScreenShareSuggestion } from '../../hooks/useGamePresence'
import { setPendingGameShareHint } from '../../lib/screenShareGameHint'
import { setPendingAppAudioPid } from '../../lib/pendingAppAudioCapture'
import { subscribeScreenSharePicker, resolveScreenSharePicker } from '../../lib/screenSharePickerBridge'
import { QUALITY_PRESETS, loadQuality } from '../../hooks/useScreenShareQuality'
import { armScreenShareChoice } from '../../lib/chooseScreenShareSource'

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
// electron/main.cjs) sempre ganha a própria seção em destaque quando dá
// pra resolver uma fonte pra ela — seja uma JANELA de verdade
// (isExactGameWindow) seja o fallback de TELA CHEIA (isGameDisplay, pro
// caso comum de jogo em modo exclusivo/sem janela própria capturável).
// A seção chama "Jogo" quando é um processo CADASTRADO (KNOWN_GAMES,
// `isKnownGame: true`); pra qualquer outro app/jogo detectado (a última
// janela em primeiro plano antes de abrir esse seletor) chama "Sugestão"
// — não dá pra saber com certeza que é um jogo, então não afirma isso na
// cara da pessoa, mas ainda mostra em destaque (antes disso esse caso só
// ganhava um contorno discreto dentro de "Janela"/"Tela cheia", fácil de
// não notar — e o fallback de tela cheia sequer tinha esse contorno,
// porque isGameDisplay nunca era usado aqui apesar de já vir calculado
// do processo principal).
export function ScreenSharePicker() {
  const [sources, setSources] = useState<ScreenShareSource[] | null>(null)
  const [suggestion, setSuggestion] = useState<ScreenShareSuggestion | null>(null)

  // OITAVA RODADA: em vez de escutar um evento que chega sozinho, agora
  // se inscreve na "caixa de correio" de screenSharePickerBridge.ts —
  // VoiceContext.tsx busca a lista de fontes (getScreenShareSources) e
  // "abre" o picker com ela; aqui só reage a isso. payload null fecha o
  // picker de novo (usado logo depois de escolher/cancelar, ver choose
  // abaixo).
  useEffect(() => {
    return subscribeScreenSharePicker((payload) => {
      setSources(payload?.sources ?? null)
      setSuggestion(payload?.suggestion ?? null)
    })
  }, [])

  if (!sources) return null
  // TypeScript não propaga o `if (!sources) return null` acima pra
  // dentro de `choose` (uma função aninhada, fechamento separado) —
  // essa constante com tipo explícito (não-nulo) resolve isso sem
  // precisar de `!` no meio do código.
  const confirmedSources: ScreenShareSource[] = sources

  // Prioriza uma JANELA exata quando existe; só cai pro fallback de TELA
  // CHEIA (isGameDisplay) quando não tem janela capturável pro jogo —
  // exatamente o caso mais comum de jogo em modo exclusivo/borderless
  // sem título, que antes ficava sem destaque nenhum.
  const suggestedSource = sources.find((s) => s.isExactGameWindow) ?? sources.find((s) => s.isGameDisplay) ?? null
  const gameCard = suggestion ? suggestedSource : null
  const gameCardTitle = suggestion?.isKnownGame ? 'Jogo' : 'Sugestão'
  const screens = sources.filter((s) => s.type === 'screen' && s !== gameCard)
  const windows = sources.filter((s) => s.type === 'window' && s !== gameCard)

  const currentQualityPreset = QUALITY_PRESETS[loadQuality()]

  // DÉCIMA QUARTA RODADA: a lógica de "qual PID usar pra essa escolha, e
  // qual recado deixar pro fechamento automático" (antes vivia só aqui,
  // duplicada em pidForChoice/pidExpected) agora é compartilhada com
  // GameDetectedToast.tsx (o atalho "Compartilhar tela" do aviso
  // "Jogando X!") via armScreenShareChoice — ver o comentário grande em
  // src/lib/chooseScreenShareSource.ts pro porquê.
  // DÉCIMA OITAVA RODADA: "compartilhamento de tela não reconhece tela
  // minimizada" — Chromium exclui janelas minimizadas da lista de fontes
  // (ver looksMinimized/hwnd, calculados em electron/main.cjs), não tem
  // como listar ela pra escolher nesse estado. O que DÁ pra fazer:
  // restaurar a janela primeiro (ShowWindowAsync + SetForegroundWindow,
  // via o scanner persistente) e buscar a lista de fontes DE NOVO — sem
  // reabrir o seletor nem mexer na Promise pendente do
  // screenSharePickerBridge (VoiceContext.tsx continua esperando a MESMA
  // escolha final), só atualiza o estado local aqui com o que veio de
  // volta, já com a janela agora capturável de verdade.
  // TRIGÉSIMA SEGUNDA RODADA — removido a pedido o card vermelho de
  // "Fulano está minimizado / Restaure a janela pra poder compartilhar
  // ela" que aparecia aqui (handleRestoreAndRefresh e o estado
  // `restoring` que só existiam pra esse card também saíram, sem uso
  // nenhum). O comportamento agora: quando `looksMinimized` é true, a
  // seção "Jogo"/"Sugestão" simplesmente não aparece (gameCard fica
  // null nesse caso, já que não existe fonte capturável de verdade pra
  // apontar) — a pessoa só vê as listas normais de "Tela cheia"/"Janela"
  // embaixo, do jeito que já eram exibidas antes de qualquer detecção
  // especial de jogo existir.
  function choose(id: string | null, viaGameShortcut?: { processNames: string[]; label: string }) {
    if (id) {
      armScreenShareChoice(id, confirmedSources, gameCard, suggestion, viaGameShortcut)
    } else {
      // Cancelou — limpa qualquer recado pendente de uma escolha
      // anterior, defensivo, pra nunca "vazar" pra uma captura sem
      // relação com ele.
      setPendingGameShareHint(null)
      setPendingAppAudioPid(null)
    }
    resolveScreenSharePicker(id)
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
            <SourceSection title={gameCardTitle}>
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
              {/* Sem prop "highlighted" aqui de propósito: quando existe
                  uma sugestão, ela já vira sua própria seção acima
                  ("Jogo"/"Sugestão") e é excluída desta lista — nunca
                  sobra uma janela sugerida pra destacar aqui dentro. */}
              {windows.map((s) => (
                <SourceCard key={s.id} source={s} onClick={() => choose(s.id)} />
              ))}
            </SourceSection>
          )}
        </div>

        {/* Dois lembretes cobrindo os dois motivos mais comuns de uma
            janela não aparecer aqui: (1) jogo em modo tela cheia
            EXCLUSIVA de verdade, sem janela nenhuma pro Windows listar —
            resolve trocando pra "tela cheia sem bordas"; (2) qualquer
            janela (navegador incluso) MINIMIZADA — o Windows não
            consegue gerar uma miniatura de uma janela minimizada, então
            NENHUM programa de captura (nem Discord, Zoom, OBS) lista
            ela nesse estado — não é bug nosso, é limitação do próprio
            Windows. Precisa estar pelo menos visível (pode estar atrás
            de outra janela) na hora de abrir esse seletor. */}
        <p className="text-[10px] text-discord-text-muted mt-3">
          Jogo não aparece como janela? Troque pra "tela cheia sem bordas" nas configurações dele.
        </p>
        <p className="text-[10px] text-discord-text-muted mt-1">
          Não vê a janela que procura? Ela pode estar minimizada — o Windows só mostra aqui janelas abertas e visíveis (restaure a janela e tente de novo).
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
