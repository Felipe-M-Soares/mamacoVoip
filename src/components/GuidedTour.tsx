import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Tour guiado: escurece a tela, destaca uma parte de cada vez e explica.
// No primeiro uso o app pergunta se a pessoa quer fazer (TourOffer);
// depois dá pra refazer em Configurações (evento 'mv:start-tour').
// Passos cujo alvo não está na tela agora (ex.: sem servidor aberto) são
// pulados sozinhos.

// `drawer`: no celular o alvo fica dentro do menu lateral — o tour abre
// o menu antes de mostrar o passo.
type Step = { target?: string; title: string; text: string; drawer?: boolean }

const STEPS: Step[] = [
  {
    title: 'Bem-vindo ao Mamacos Voip! 🎮',
    text: 'Em menos de um minuto você conhece o básico. Dá pra sair do tour a qualquer hora com Esc.',
  },
  {
    target: '[data-tour="servers"]',
    drawer: true,
    title: 'Seus servidores',
    text: 'Cada ícone aqui é um servidor: um espaço da sua galera, com canais de texto e de voz.',
  },
  {
    target: '[aria-label="Adicionar um servidor"]',
    drawer: true,
    title: 'Criar ou entrar num servidor',
    text: 'Clique no + pra criar o seu servidor ou entrar num usando um link de convite.',
  },
  {
    target: '[aria-label="Início"]',
    drawer: true,
    title: 'Início: amigos e conversas',
    text: 'Aqui ficam seus amigos, pedidos de amizade, conversas privadas e grupos.',
  },
  {
    target: '[data-tour="channels"]',
    drawer: true,
    title: 'Canais do servidor',
    text: 'Canais com # são de texto. Clique pra conversar. Os com alto-falante são salas de voz.',
  },
  {
    target: '[data-tour="voice-channel"]',
    drawer: true,
    title: 'Salas de voz',
    text: 'Clique numa sala de voz pra entrar. Lá dá pra falar, ligar a câmera, transmitir a tela do jogo e usar o soundboard. Clicando em alguém da sala você ajusta o volume, manda mensagem e mais.',
  },
  {
    target: '[data-tour="composer"]',
    title: 'Mandar mensagens',
    text: 'Escreva e aperte Enter. Tem GIFs, figurinhas, áudio e anexos, e dá pra colar um print com Ctrl+V.',
  },
  {
    target: '[aria-label="Membros"]',
    title: 'Quem está no servidor',
    text: 'Mostra a lista de membros, separada por cargos, com quem está jogando ou em voz.',
  },
  {
    target: '[data-tour="user-panel"]',
    drawer: true,
    title: 'Seu painel',
    text: 'Seu perfil e status, desligar microfone ou fone, e o ping. Durante uma chamada, os controles dela aparecem aqui também.',
  },
  {
    target: '[aria-label="Configurações"]',
    drawer: true,
    title: 'Configurações',
    text: 'Perfil, temas, microfone e câmera, atalhos de teclado e notificações. Dá pra refazer este tour por lá.',
  },
  {
    title: 'Tudo pronto! 🚀',
    text: 'Agora é chamar a galera. Se ficar com dúvida, refaça o tour em Configurações → "Fazer o tour guiado".',
  },
]

const isMobileWidth = () => window.innerWidth < 1024

// Só conta alvo VISÍVEL na tela (no celular, o que está no menu lateral
// fechado fica fora da tela e antes o cartão ia parar fora da tela junto).
function findTarget(step: Step): HTMLElement | null {
  if (!step.target) return null
  const els = Array.from(document.querySelectorAll<HTMLElement>(step.target))
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight) return el
  }
  return null
}

function stepAvailable(step: Step): boolean {
  if (!step.target) return true
  if (findTarget(step)) return true
  // No celular, o que mora no menu lateral existe mas está escondido.
  return Boolean(step.drawer && isMobileWidth() && document.querySelector(step.target))
}

function setMobileDrawer(open: boolean) {
  window.dispatchEvent(new CustomEvent('mv:mobile-drawer', { detail: { open } }))
}

export function GuidedTour({ onClose }: { onClose: () => void }) {
  // Só os passos que dá pra mostrar agora (sem alvo = cartão no centro).
  const [steps] = useState(() => STEPS.filter(stepAvailable))
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[index]

  const measure = useCallback(() => {
    const el = step ? findTarget(step) : null
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  useLayoutEffect(() => {
    // Celular: abre o menu lateral nos passos que precisam dele (e fecha
    // nos outros), e mede depois da animação de abrir.
    if (isMobileWidth()) {
      setMobileDrawer(Boolean(step?.drawer))
      setRect(null)
      const t = window.setTimeout(measure, 320)
      return () => window.clearTimeout(t)
    }
    measure()
  }, [measure, step])

  // Ao terminar o tour no celular, fecha o menu que ele abriu.
  useEffect(() => () => {
    if (isMobileWidth()) setMobileDrawer(false)
  }, [])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  function next() {
    if (index >= steps.length - 1) onClose()
    else setIndex(index + 1)
  }

  if (!step) return null
  const pad = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardW = Math.min(340, vw - 24)

  // Cartão ao lado do destaque (direita, senão esquerda, senão acima/abaixo).
  let cardStyle: React.CSSProperties = { left: (vw - cardW) / 2, top: vh / 2 - 110, width: cardW }
  if (vw < 640) {
    // Celular: cartão largo embaixo (ou em cima, se o destaque estiver
    // na metade de baixo da tela), sem nunca sair da tela.
    const w = vw - 24
    cardStyle = rect && rect.top + rect.height / 2 > vh / 2 ? { left: 12, top: 12, width: w } : { left: 12, bottom: 16, width: w }
    if (!rect) cardStyle = { left: 12, top: vh / 2 - 110, width: w }
  } else if (rect) {
    const spaceRight = vw - rect.right
    const spaceLeft = rect.left
    if (spaceRight > cardW + 24) cardStyle = { left: rect.right + 16, top: Math.min(Math.max(12, rect.top), vh - 240), width: cardW }
    else if (spaceLeft > cardW + 24) cardStyle = { left: rect.left - cardW - 16, top: Math.min(Math.max(12, rect.top), vh - 240), width: cardW }
    else if (rect.top > 260)
      cardStyle = { left: Math.min(Math.max(12, rect.left), vw - cardW - 12), top: rect.top - 16 - 210, width: cardW }
    else cardStyle = { left: Math.min(Math.max(12, rect.left), vw - cardW - 12), top: Math.min(rect.bottom + 16, vh - 230), width: cardW }
  }

  // Nunca deixa o cartão sair da tela.
  if (typeof cardStyle.left === 'number') cardStyle.left = Math.min(Math.max(12, cardStyle.left), vw - cardW - 12)
  if (typeof cardStyle.top === 'number') cardStyle.top = Math.min(Math.max(12, cardStyle.top), vh - 240)

  return createPortal(
    <div className="fixed inset-0 z-[2000]" role="dialog" aria-modal="true" aria-label="Tour guiado">
      {/* Escurece tudo menos o destaque. */}
      {rect ? (
        <div
          className="fixed rounded-xl transition-all duration-300 pointer-events-none ring-2 ring-mv-accent"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.68), 0 0 24px 2px var(--color-mv-accent)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70" />
      )}
      {/* Bloqueia cliques no app durante o tour. */}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="fixed surface-elevated rounded-2xl p-4 animate-pop-in" style={cardStyle} key={index}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-accent mb-1">
          Passo {index + 1} de {steps.length}
        </p>
        <h2 className="font-display text-[17px] font-semibold text-white">{step.title}</h2>
        <p className="text-[13.5px] text-mv-muted mt-1.5 leading-relaxed">{step.text}</p>
        <div className="flex items-center gap-1 mt-3" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-mv-accent' : 'w-1.5 bg-white/20'}`} />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button type="button" onClick={onClose} className="text-[13px] text-mv-muted hover:text-white mr-auto">
            Pular tour
          </button>
          {index > 0 && (
            <button type="button" onClick={() => setIndex(index - 1)} className="h-9 px-3 btn-secondary text-[13px]">
              Voltar
            </button>
          )}
          <button type="button" onClick={next} autoFocus className="h-9 px-4 btn-primary text-[13px]">
            {index >= steps.length - 1 ? 'Concluir' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Convite do primeiro uso: "Quer fazer um tour rápido?" */
export function TourOffer({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[1900] bg-black/60 flex items-center justify-center p-4 animate-fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby="tour-offer-title" className="surface-elevated rounded-2xl p-6 max-w-sm w-full text-center animate-pop-in">
        <img src="/logo-192.png" alt="" className="w-16 h-16 rounded-2xl mx-auto mb-4" />
        <h2 id="tour-offer-title" className="font-display text-xl font-semibold text-white">
          Bem-vindo ao Mamacos Voip!
        </h2>
        <p className="text-[14px] text-mv-muted mt-2 leading-relaxed">
          Quer um tour rápido mostrando onde fica cada coisa? Leva menos de um minuto.
        </p>
        <div className="flex flex-col gap-2 mt-5">
          <button type="button" onClick={onStart} autoFocus className="h-11 btn-primary text-[14px]">
            Fazer o tour guiado
          </button>
          <button type="button" onClick={onDismiss} className="h-10 btn-ghost text-[13.5px]">
            Agora não
          </button>
        </div>
        <p className="text-[12px] text-mv-muted mt-3">Dá pra fazer depois em Configurações → "Fazer o tour guiado".</p>
      </div>
    </div>,
    document.body
  )
}
