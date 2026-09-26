// Barra de título CUSTOM do app desktop — substitui a barra nativa fina
// e cinza do Windows (que não tinha nada a ver com a cara do app e não
// dava pra deixar maior). Só existe dentro do Electron: no site (web),
// o navegador já tem sua própria barra/aba, então isso não deve
// renderizar nada lá (ver checagem de window.electronAPI abaixo).
//
// A janela é criada com titleBarStyle:'hidden' + titleBarOverlay (ver
// electron/main.cjs) — isso mantém os botões nativos de
// minimizar/maximizar/fechar (sem precisar reimplementar isso na mão
// com IPC), reservando uma faixa arrastável em cima que a gente
// preenche com o ícone + nome do app, do tamanho e cor do tema atual.
// Fica ACIMA da barra de servidores e da barra lateral de canais só por
// causa da ORDEM normal do layout (é o primeiro item dentro do
// flex-col em App.tsx, empilhado por cima do resto) — não precisa de
// z-index alto nenhum pra isso. Um z-index alto aqui (era 600 antes)
// é o que causava telas tipo Configurações ficarem com o topo cortado:
// como os modais usam `position: fixed` cobrindo a tela inteira (com
// z-index até 500), um valor MAIOR que o deles fazia essa faixa de 40px
// "furar" por cima do modal em vez de ficar por baixo dele. Mantém um
// z-index bem baixo — só o suficiente pra garantir que fica por cima do
// conteúdo normal da página (que não usa z-index nenhum), nunca de um
// modal/overlay de verdade.
export function TitleBar() {
  if (!window.electronAPI?.isElectron) return null

  return (
    <div
      className="h-10 shrink-0 flex items-center gap-2 px-3 bg-discord-sidebar border-b border-black/30 relative z-10 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src="/logo-192.png" alt="" className="w-5 h-5 rounded shrink-0" />
      <span className="font-display font-semibold text-sm tracking-wide text-discord-text">Mamacos Voip</span>
    </div>
  )
}
