import { useEffect, useRef } from 'react'
import { useWindowPlace } from '../../lib/windowTitle'
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
// Converte qualquer cor CSS calculada (rgb, color-mix, oklab…) em #rrggbb.
function toHex(css: string): string | null {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export function TitleBar() {
  const place = useWindowPlace()
  const barRef = useRef<HTMLDivElement>(null)
  const isElectron = Boolean(window.electronAPI?.isElectron)

  // Pinta os botões nativos de minimizar/maximizar/fechar com a cor desta
  // barra (e reaplica ao trocar de tema), pra não ficar um bloco de outra cor.
  useEffect(() => {
    if (!isElectron) return
    let last = ''
    const apply = () => {
      const el = barRef.current
      if (!el) return
      const cs = getComputedStyle(el)
      const color = toHex(cs.backgroundColor)
      const symbolColor = toHex(getComputedStyle(document.body).color) ?? '#f3efee'
      if (!color) return
      const key = color + symbolColor
      if (key === last) return
      last = key
      void window.electronAPI?.setTitleBarColors?.({ color, symbolColor }).catch(() => {})
    }
    apply()
    const obs = new MutationObserver(() => requestAnimationFrame(apply))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    obs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => obs.disconnect()
  }, [isElectron])

  if (!isElectron) return null

  return (
    <div
      ref={barRef}
      className="h-10 shrink-0 flex items-center gap-2.5 px-3.5 bg-mv-side border-b border-[var(--color-line)] relative z-10 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img src="/logo-192.png" alt="" className="w-5 h-5 rounded-md shrink-0 ring-1 ring-[var(--color-line-strong)]" />
      <span className="font-display font-semibold text-[13px] text-mv-muted">Mamacos <span className="text-mv-text">Voip</span></span>
      {place && (
        // Centralizado na janela inteira (não só no espaço que sobra).
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 max-w-[40%] pointer-events-none">
          {place.iconUrl ? (
            <img src={place.iconUrl} alt="" className="w-4 h-4 rounded-[5px] object-cover shrink-0" />
          ) : null}
          <span className="font-display font-semibold text-[13px] text-mv-text truncate">{place.label}</span>
        </div>
      )}
    </div>
  )
}
