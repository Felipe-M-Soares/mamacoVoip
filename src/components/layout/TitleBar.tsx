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
// Fica no TOPO de TUDO (acima da barra de servidores E da barra
// lateral de canais) porque é renderizado no nível mais alto do App,
// antes de qualquer layout de página — exatamente o "ficar em cima
// dessa barra lateral" pedido.
export function TitleBar() {
  if (!window.electronAPI?.isElectron) return null

  return (
    <div
      className="h-10 shrink-0 flex items-center gap-2 px-3 bg-discord-sidebar border-b border-black/30 relative z-[600] select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src="/logo-192.png" alt="" className="w-5 h-5 rounded shrink-0" />
      <span className="font-display font-semibold text-sm tracking-wide text-discord-text">Mamacos Voip</span>
    </div>
  )
}
