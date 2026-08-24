import { useState } from 'react'

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
      <path d="M5.5 4.5c.5-.5 1.2-.8 2-.8h1.4l-.3 15h-1c-.8 0-1.5-.3-2-.8-.6-.5-.9-1.2-.9-2v-9.4c0-.8.3-1.5.8-2zm10 0c.5.5.8 1.2.8 2v9.4c0 .8-.3 1.5-.8 2-.5.5-1.2.8-2 .8h-1l-.3-15h1.4c.8 0 1.5.3 2 .8z" />
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

  return (
    <div className="fixed inset-0 z-[400] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-discord-dark rounded-2xl shadow-2xl border border-discord-blurple/20 overflow-hidden">
        <div className="p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-discord-blurple to-discord-darker flex items-center justify-center mx-auto mb-4 brand-glow-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white">
              {slide.icon}
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold text-white tracking-wide mb-2">{slide.title}</h2>
          <p className="text-sm text-discord-text-muted leading-relaxed">{slide.text}</p>

          <div className="flex items-center justify-center gap-1.5 mt-5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-5 bg-discord-blurple' : 'w-1.5 bg-discord-text-muted/40'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2 mt-5">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex-1 py-2.5 rounded border border-discord-text-muted text-discord-text hover:bg-white/5 transition-colors"
              >
                Voltar
              </button>
            )}
            <button
              onClick={() => (isLast ? onDismiss() : setStep((s) => s + 1))}
              className="flex-1 py-2.5 rounded btn-primary text-sm"
            >
              {isLast ? 'Vamos lá!' : 'Próximo'}
            </button>
          </div>

          {!isLast && (
            <button onClick={onDismiss} className="mt-3 text-xs text-discord-text-muted hover:text-white transition-colors">
              Pular
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
