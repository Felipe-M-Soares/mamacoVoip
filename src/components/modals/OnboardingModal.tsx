import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

function seenKey(userId: string) {
  return `mamacos-onboarding-seen:${userId}`
}

// Mesma ideia do useServerWelcomeScreen (ServerWelcomeModal.tsx): só
// guarda localmente que a pessoa já viu, sem precisar de coluna nova
// no banco pra algo que é puramente de interface.
export function useOnboarding(userId: string | undefined) {
  const [show, setShow] = useState(() => {
    if (!userId) return false
    try {
      return !localStorage.getItem(seenKey(userId))
    } catch {
      return false
    }
  })

  function dismiss() {
    if (userId) {
      try {
        localStorage.setItem(seenKey(userId), '1')
      } catch {
        // best-effort
      }
    }
    setShow(false)
  }

  return { show, dismiss }
}

const SLIDES = [
  {
    title: 'Bem-vindo ao Mamacos Voip!',
    text: 'Um espaço pra conversar por texto, voz e vídeo com seus amigos e comunidades — vamos te mostrar o básico em poucos passos.',
    icon: (
      <path d="M12 2.5l2.35 5.9 6.15.55-4.7 4.1 1.45 6.2L12 15.95 6.75 19.25l1.45-6.2-4.7-4.1 6.15-.55z" />
    ),
  },
  {
    title: 'Servidores e canais',
    text: 'Cada ícone na barra da esquerda é um servidor — uma comunidade com vários canais de texto e voz dentro. Clique em "+" pra criar o seu ou entrar num com um convite.',
    icon: (
      <path d="M4 4h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 9h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zm2.5 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    ),
  },
  {
    title: 'Chamada de voz e vídeo',
    text: 'Entre num canal de voz clicando nele. Dá pra ativar a câmera, compartilhar tela e usar soundboard direto por lá.',
    icon: (
      <path d="M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zm-7 9a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 12z" />
    ),
  },
  {
    title: 'Mensagens diretas',
    text: 'Prefere conversar só com uma pessoa ou um grupo pequeno? Use o ícone de "Início" no topo da barra de servidores pra ver seus amigos e DMs.',
    icon: (
      <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />
    ),
  },
]

export function OnboardingModal({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0)
  const slide = SLIDES[step]
  const isLast = step === SLIDES.length - 1
  const dialogRef = useRef<HTMLDivElement>(null)

  // Leva o foco pro diálogo ao abrir (leitor de tela anuncia o título).
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  // Portal no <body>: se algum ancestral tiver transform/filter, um
  // "fixed" dentro dele passa a ser relativo a esse ancestral (e o
  // overlay aparecia preso dentro da barra lateral).
  return createPortal(
    <div className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm animate-fade-in flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        ref={dialogRef}
        tabIndex={-1}
        className="outline-none relative w-full max-w-md surface-elevated rounded-2xl overflow-hidden animate-pop-in"
      >
        {/* Brilho suave da marca atrás da ilustração */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-48 opacity-60 pointer-events-none"
          style={{
            background:
              'radial-gradient(60% 70% at 50% 0%, color-mix(in srgb, var(--color-discord-blurple) 35%, transparent), transparent 70%)',
          }}
        />
        <div className="relative px-6 pt-5 pb-6 text-center">
          <div className="flex items-center justify-between h-8 mb-4">
            <span className="text-[12px] font-medium text-discord-text-muted tabular-nums">
              Passo {step + 1} de {SLIDES.length}
            </span>
            {!isLast && (
              <button onClick={onDismiss} className="btn-ghost h-8 px-3 text-[13px]">
                Pular
              </button>
            )}
          </div>

          <div key={step} className="animate-fade-slide-in">
            <div className="relative w-20 h-20 mx-auto mb-5">
              <div aria-hidden="true" className="absolute inset-0 rounded-[26px] bg-brand-gradient blur-xl opacity-50" />
              <div className="relative w-20 h-20 rounded-[26px] bg-brand-gradient flex items-center justify-center shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9 text-white drop-shadow" aria-hidden="true">
                  {slide.icon}
                </svg>
              </div>
            </div>
            <h2 id="onboarding-title" className="font-display text-xl font-semibold text-white mb-2">
              {slide.title}
            </h2>
            <p className="text-[14px] text-discord-text-muted leading-relaxed min-h-[4.5rem]">{slide.text}</p>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-5" aria-hidden="true">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? 'w-6 bg-brand-gradient' : i < step ? 'w-1.5 bg-discord-blurple/60' : 'w-1.5 bg-white/15'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2 mt-6">
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)} className="flex-1 h-10 btn-secondary text-sm">
                Voltar
              </button>
            )}
            <button
              onClick={() => (isLast ? onDismiss() : setStep((s) => s + 1))}
              className="flex-1 h-10 btn-primary text-sm"
            >
              {isLast ? 'Vamos lá!' : 'Próximo'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
