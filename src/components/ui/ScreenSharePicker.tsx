import { useEffect, useMemo, useState } from 'react'
import type { ScreenShareSource } from '../../hooks/useGamePresence'
import { setPendingGameShareHint } from '../../lib/screenShareGameHint'

// Discord tem um atalho de "compartilhar seu jogo" assim que detecta que
// você está com um jogo aberto — em vez de forçar a pessoa a procurar a
// janela certa na lista. A gente já sabe o nome bonito do jogo (mesmo
// dado que aparece em "Jogando X" no perfil, vindo da detecção de
// processo em electron/main.cjs), então só falta achar, entre as janelas
// que o Electron listou, qual delas provavelmente é a do próprio jogo.
// Não existe uma API que ligue "processo detectado" a "janela do
// desktopCapturer" diretamente (são sistemas diferentes), então usamos
// uma heurística: a maioria dos jogos usa o próprio nome como título da
// janela, então comparamos (ignorando maiúsculas/pontuação) se um nome
// contém o outro.
function findGameSource(sources: ScreenShareSource[], gameName: string | null): ScreenShareSource | null {
  if (!gameName) return null
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
    // Com mais de um monitor, prioriza a tela PRINCIPAL — quem joga com
    // dois monitores normalmente tem o jogo no principal e outras coisas
    // (navegador, chat) no secundário, então essa é a aposta mais segura
    // pra não compartilhar sem querer a tela errada. Sem essa marcação
    // (app desktop mais antigo, por exemplo), cai de volta pro
    // comportamento de antes: só pega a primeira da lista.
    return screens.find((s) => s.isPrimaryDisplay) ?? screens[0] ?? null
  }, [sources, currentGame, windowMatch])

  const gameSource = windowMatch ?? fallbackScreen
  const isFullscreenFallback = !windowMatch && Boolean(fallbackScreen)

  if (!sources) return null

  function choose(id: string | null) {
    window.electronAPI?.selectScreenShareSource(id).catch(() => {
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
        <p className="text-xs text-discord-text-muted mb-4">Uma tela inteira ou só uma janela específica</p>

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
