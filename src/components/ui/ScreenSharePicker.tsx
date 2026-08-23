import { useEffect, useMemo, useState } from 'react'
import type { ScreenShareSource } from '../../hooks/useGamePresence'
import { setPendingGameShareHint } from '../../lib/screenShareGameHint'
import { QUALITY_PRESETS, loadQuality } from '../../hooks/useScreenShareQuality'

// Discord tem um atalho de "compartilhar seu jogo" assim que detecta que
// você está com um jogo aberto — em vez de forçar a pessoa a procurar a
// janela certa na lista. A gente já sabe o nome bonito do jogo (mesmo
// dado que aparece em "Jogando X" no perfil, vindo da detecção de
// processo em electron/main.cjs), então só falta achar, entre as janelas
// que o Electron listou, qual delas é a do próprio jogo.
//
// Duas formas de achar, em ordem de confiança: (1) `isExactGameWindow`
// — o próprio Windows já confirmou que o TÍTULO dessa janela bate exato
// com o da janela do processo do jogo (electron/main.cjs consulta isso
// via PowerShell/.NET); bem mais confiável, usa isso quando disponível.
// (2) Fallback: uma heurística por nome PARECIDO (a maioria dos jogos
// usa o próprio nome como título de janela, então compara ignorando
// maiúsculas/pontuação se um nome contém o outro) — só entra quando (1)
// não deu (Mac/Linux, ou o Windows não conseguiu descobrir o título).
function findGameSource(sources: ScreenShareSource[], gameName: string | null): ScreenShareSource | null {
  if (!gameName) return null
  const exact = sources.find((s) => s.type === 'window' && s.isExactGameWindow)
  if (exact) return exact
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = normalize(gameName)
  if (!target) return null
  return sources.find((s) => {
    const name = normalize(s.name)
    return name.length > 0 && (name.includes(target) || target.includes(name))
  }) ?? null
}

export function ScreenSharePicker() {
  const [sources, setSources] = useState<ScreenShareSource[] | null>(null)
  const [currentGame, setCurrentGame] = useState<string | null>(null)
  // Áudio do sistema junto com a tela: desligado por padrão. O Windows
  // só sabe capturar o som de TODO o sistema (nunca de uma janela
  // específica sozinha) — então essa opção só faz efeito quando a
  // pessoa escolhe compartilhar uma TELA INTEIRA. Antes isso ficava
  // ligado sempre sem escolha nenhuma, e além de vazar áudio de outros
  // apps, também recapturava a própria call saindo pelo alto-falante —
  // um eco de verdade. Ver electron/main.cjs (screen-share:select).
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.onScreenShareSources(setSources)
  }, [])

  // Mesma fonte que já alimenta o "Jogando X" do perfil (useGamePresence) —
  // só pra saber qual jogo sugerir no atalho abaixo, sem duplicar a
  // detecção em si.
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.getCurrentGame().then(setCurrentGame)
    return window.electronAPI.onGameStatusChanged(setCurrentGame)
  }, [])

  const windowMatch = useMemo(() => (sources ? findGameSource(sources, currentGame) : null), [sources, currentGame])

  // Muitos jogos rodam em modo "tela cheia exclusiva" no Windows — nesse
  // modo, o compositor do sistema (DWM) nem "enxerga" o jogo como uma
  // janela separada, só a API de tela inteira consegue capturá-lo. Então,
  // se a gente sabe que tem um jogo aberto mas não achou nenhuma janela
  // com esse nome na lista, a melhor aposta é oferecer a primeira tela
  // inteira disponível como atalho "compartilhar seu jogo" — na prática é
  // isso que vai mostrar o jogo pra quem está assistindo.
  const fallbackScreen = useMemo(() => {
    if (!sources || !currentGame || windowMatch) return null
    const screens = sources.filter((s) => s.type === 'screen')
    // Prioridade: (1) o monitor que o Windows CONFIRMOU ser onde a
    // janela do próprio jogo está (isGameDisplay — bem mais confiável,
    // funciona certo mesmo com o jogo no monitor secundário); (2) se não
    // deu pra descobrir isso, cai pro chute de "tela principal" de
    // antes (a maioria de quem tem um monitor só, ou não conseguiu essa
    // detecção por algum motivo); (3) por fim, a primeira da lista.
    return screens.find((s) => s.isGameDisplay) ?? screens.find((s) => s.isPrimaryDisplay) ?? screens[0] ?? null
  }, [sources, currentGame, windowMatch])

  const gameSource = windowMatch ?? fallbackScreen
  const isFullscreenFallback = !windowMatch && Boolean(fallbackScreen)

  if (!sources) return null

  // Só pra EXIBIR o preset atual aqui (não dá pra mudar daqui — ver o
  // comentário grande em VoiceChannelView.tsx sobre por que a escolha
  // de qualidade/fps precisa acontecer ANTES de abrir esse seletor).
  // Lida direto do localStorage a cada abertura em vez de guardar em
  // state, porque esse componente fica montado o tempo todo (só
  // aparece/some trocando `sources` entre null/preenchido) — se lesse
  // só uma vez no mount, nunca acompanharia uma troca feita depois.
  const currentQualityPreset = QUALITY_PRESETS[loadQuality()]

  function choose(id: string | null) {
    window.electronAPI?.selectScreenShareSource(id, includeSystemAudio).catch(() => {
      // best-effort — cancelar o compartilhamento não deve nunca quebrar a tela
    })
    setSources(null)
  }

  // Escolher qualquer coisa que NÃO seja o atalho "compartilhar seu
  // jogo" (uma janela ou tela específica da grade abaixo) precisa limpar
  // um recado de jogo que porventura tenha ficado setado — defensivo,
  // não deveria acontecer no fluxo normal, mas evita um auto-stop
  // errado "vazando" pra uma captura sem relação nenhuma com jogo.
  function chooseFromGrid(id: string) {
    setPendingGameShareHint(null)
    choose(id)
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
        <h2 className="font-display text-lg font-bold text-white tracking-wide mb-1">
          Escolha o que compartilhar
        </h2>
        <p className="text-xs text-discord-text-muted mb-1">Uma tela inteira ou só uma janela específica</p>
        <p className="text-[11px] text-discord-text-muted mb-4">
          Qualidade selecionada: <span className="text-discord-text font-medium">{currentQualityPreset.label}</span>
          {' — '}pra mudar, feche aqui e ajuste no seletor do lado do botão de compartilhar tela, antes de tentar de novo.
        </p>

        {/* Vale só pra "tela inteira" — pra janela específica o Windows
            não tem como isolar o som de só ela, então nem oferece a
            opção. Padrão desligado: ligar isso reduz a chance de eco,
            mas ainda assim recomenda fone quando estiver ativo, porque
            o som da própria call sai pelo alto-falante de quem
            compartilha e pode ser recapturado pelo microfone/loopback. */}
        <label className="flex items-start gap-2.5 mb-4 p-2.5 rounded-lg bg-discord-darker/60 cursor-pointer">
          <input
            type="checkbox"
            checked={includeSystemAudio}
            onChange={(e) => setIncludeSystemAudio(e.target.checked)}
            className="mt-0.5 accent-discord-blurple"
          />
          <span className="text-xs text-discord-text">
            Compartilhar áudio do sistema
            <span className="block text-[11px] text-discord-text-muted mt-0.5">
              Só funciona ao escolher uma tela inteira (o Windows não isola o som de uma janela específica). Use fone
              de ouvido ao ativar — sem fone, o som da própria call pode ser recapturado e causar eco.
            </span>
          </span>
        </label>

        {gameSource && currentGame && (
          <button
            onClick={() => {
              // Só precisa do "recado" no caso de tela cheia (sem janela
              // própria pra detectar o fechamento sozinha) — ver o
              // comentário grande em screenShareGameHint.ts. Compartilhar
              // a JANELA do jogo já para sozinho quando ela fecha, sem
              // precisar de nada extra aqui.
              setPendingGameShareHint(isFullscreenFallback ? currentGame : null)
              choose(gameSource.id)
            }}
            className="w-full flex items-center gap-3 mb-4 p-2.5 rounded-lg border-2 border-discord-blurple bg-discord-blurple/10 hover:bg-discord-blurple/20 transition-colors text-left"
          >
            <img
              src={gameSource.thumbnail}
              alt={gameSource.name}
              className="w-24 aspect-video object-cover rounded shrink-0 bg-black"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase text-discord-blurple tracking-wide">
                Compartilhar seu jogo
              </p>
              <p className="text-sm font-semibold text-white truncate">🎮 {currentGame}</p>
              {isFullscreenFallback && (
                <p className="text-[11px] text-discord-text-muted mt-0.5">
                  Tela inteira — pausa sozinha (Windows) se você alternar pra fora do jogo
                </p>
              )}
            </div>
          </button>
        )}


        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => chooseFromGrid(s.id)}
              className="text-left rounded-lg overflow-hidden border-2 border-transparent hover:border-discord-blurple transition-colors bg-discord-darker"
            >
              <img src={s.thumbnail} alt={s.name} className="w-full aspect-video object-cover bg-black" />
              <p className="text-xs text-discord-text px-2 py-1.5 truncate">{s.name}</p>
            </button>
          ))}
        </div>

        <button onClick={() => choose(null)} className="mt-4 w-full py-2.5 rounded btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  )
}
