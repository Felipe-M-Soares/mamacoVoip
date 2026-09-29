import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { DESKTOP_DOWNLOAD_URL } from '../lib/config'

// Peças visuais compartilhadas pelas telas de entrada (login, cadastro,
// esqueci/redefinir senha, 2FA, convite). Só apresentação — toda a lógica
// (validação, rate limit, chamadas ao Supabase) continua em cada página.

const HIGHLIGHTS: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'Voz em alta qualidade',
    text: 'Áudio limpo, com supressão de ruído e baixa latência.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
      </svg>
    ),
  },
  {
    title: 'Compartilhamento de tela',
    text: 'Mostre o jogo ou a tela inteira pra galera, com áudio.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4M12 8v5M9.5 10.5 12 8l2.5 2.5" />
      </svg>
    ),
  },
  {
    title: 'Servidores e amigos',
    text: 'Canais de texto e voz, mensagens diretas e chamadas.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
      </svg>
    ),
  },
]

/** Moldura das telas de entrada: painel de marca à esquerda (desktop) e o cartão do formulário à direita. */
export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth-backdrop relative flex min-h-full flex-col overflow-hidden">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 items-center justify-center gap-12 px-4 py-8 sm:px-6 lg:justify-between lg:px-10">
        <section className="hidden max-w-md flex-1 lg:block animate-fade-slide-in" aria-label="Sobre o Mamacos Voip">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="h-12 w-12 rounded-2xl object-cover ring-1 ring-[var(--color-line-strong)]" />
            <span className="font-display text-lg font-semibold text-white">Mamacos Voip</span>
          </div>
          <h2 className="mt-8 font-display text-[40px] font-bold leading-[1.1] text-white">
            Sua galera, <span className="text-gradient">sempre a um clique.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-discord-text-muted">
            Converse por voz, compartilhe a tela e organize seus grupos em servidores — tudo num lugar só.
          </p>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex items-start gap-3.5 rounded-xl border border-[var(--color-line)] bg-white/[0.03] p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-discord-blurple/15 text-discord-blurple ring-1 ring-inset ring-discord-blurple/25">
                  {h.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-white">{h.title}</span>
                  <span className="mt-0.5 block text-[13px] text-discord-text-muted">{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className={`w-full ${wide ? 'max-w-[460px]' : 'max-w-[420px]'} shrink-0`}>
          <div className="surface-elevated animate-pop-in rounded-2xl p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Cabeçalho do cartão: logo (no mobile), título e subtítulo. */
export function AuthHeader({ title, subtitle, icon }: { title: string; subtitle?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="text-center lg:text-left">
      {icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-discord-blurple/15 text-discord-blurple ring-1 ring-inset ring-discord-blurple/25 lg:mx-0 [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      ) : (
        <img src="/logo.png" alt="Mamacos Voip" className="mx-auto mb-4 h-14 w-14 rounded-2xl object-cover ring-1 ring-[var(--color-line-strong)] lg:hidden" />
      )}
      <h1 className="font-display text-2xl font-semibold text-white">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[14px] text-discord-text-muted">{subtitle}</p>}
    </div>
  )
}

export function AuthAlert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : tone === 'success'
        ? 'border-discord-green/30 bg-discord-green/10 text-discord-green'
        : 'border-[var(--color-line-strong)] bg-white/[0.04] text-discord-text'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13px] leading-snug ${styles}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px h-4 w-4 shrink-0" aria-hidden>
        {tone === 'success' ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4.5M12 16h.01" />
          </>
        )}
      </svg>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3" role="separator">
      <div className="h-px flex-1 bg-[var(--color-line)]" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-discord-text-muted">ou</span>
      <div className="h-px flex-1 bg-[var(--color-line)]" />
    </div>
  )
}

export function DesktopDownloadChip() {
  return (
    <div className="mt-6 flex justify-center">
      <a
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className="chip !px-3 !py-1.5 !text-[12px] transition-colors hover:border-[var(--color-line-strong)] hover:bg-white/[0.08] hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
          <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
        </svg>
        Baixar o app pra PC
      </a>
    </div>
  )
}

export const AuthIcons = {
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M16 7l3 3M14 9l2 2" />
    </svg>
  ),
}

type AuthFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string
  icon: ReactNode
  hint?: ReactNode
  labelAside?: ReactNode
  /** Mostra o botão de mostrar/ocultar (só para type="password"). */
  revealable?: boolean
}

/** Campo com rótulo, ícone à esquerda e (opcional) botão de mostrar/ocultar senha. */
export function AuthField({ label, icon, hint, labelAside, revealable, type = 'text', id, ...rest }: AuthFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = hint ? `${inputId}-hint` : undefined
  const [revealed, setRevealed] = useState(false)
  const effectiveType = revealable && type === 'password' && revealed ? 'text' : type

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-discord-text-muted" aria-hidden>
          {icon}
        </span>
        <input
          id={inputId}
          type={effectiveType}
          aria-describedby={hintId}
          className={`h-11 w-full bg-discord-darker pl-10 ${revealable ? 'pr-11' : 'pr-3'} text-[15px] text-discord-text outline-none`}
          {...rest}
        />
        {revealable && type === 'password' && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Ocultar senha' : 'Mostrar senha'}
            title={revealed ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={revealed}
            className="icon-btn absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2"
          >
            {revealed ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.9 8.3 2.5 12 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 4.6-1.2" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-[12px] text-discord-text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
