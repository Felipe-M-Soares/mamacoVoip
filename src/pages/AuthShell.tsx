import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { ANDROID_DOWNLOAD_URL, DESKTOP_DOWNLOAD_URL } from '../lib/config'
import { isNativeMobileApp } from '../lib/platform'
import { GamepadIcon, MicIcon, ScreenShareIcon } from '../components/ui/hudIcons'

const HIGHLIGHTS: { title: string; text: string; icon: ReactNode }[] = [
  { title: 'Voz em alta qualidade', text: 'Supressão de ruído e baixa latência', icon: <MicIcon className="h-5 w-5" aria-hidden /> },
  { title: 'Transmita seu jogo', text: 'Tela inteira ou só a janela, com áudio', icon: <ScreenShareIcon className="h-5 w-5" aria-hidden /> },
  { title: 'Escritório 3D e minigames', text: 'Sua galera num lugar só', icon: <GamepadIcon className="h-5 w-5" aria-hidden /> },
]

export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="mv-auth relative flex min-h-full flex-col overflow-hidden">
      <div aria-hidden className="mv-auth-floor pointer-events-none absolute inset-x-0 bottom-0" />
      <div aria-hidden className="mv-auth-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-4 py-8 sm:px-6 lg:flex-row lg:justify-between lg:gap-12 lg:px-10">
        <section className="flex w-full max-w-md flex-col items-center text-center lg:items-start lg:text-left animate-fade-slide-in" aria-label="Sobre o Mamacos Voip">
          <div className="mv-auth-logo">
            <img src="/logo.png" alt="" className="h-full w-full object-cover" />
          </div>
          <p className="mt-6 hidden font-display text-[12px] font-semibold uppercase tracking-[0.3em] text-mv-muted lg:block">Lobby</p>
          <h2 className="mv-auth-title mt-2 font-display font-bold leading-[0.95] text-white">
            MAMACOS
            <span className="block">VOIP</span>
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-mv-muted max-lg:hidden">
            Voz, tela e a galera inteira no mesmo lobby. Entra que a partida já vai começar.
          </p>
          <ul className="mt-8 hidden w-full space-y-2.5 lg:block">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="mv-auth-perk">
                <span className="mv-auth-perk-icon">{h.icon}</span>
                <span className="min-w-0">
                  <span className="block font-display text-[14px] font-semibold tracking-wide text-white">{h.title}</span>
                  <span className="mt-0.5 block text-[13px] text-mv-muted">{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className={`w-full ${wide ? 'max-w-[460px]' : 'max-w-[420px]'} shrink-0`}>
          <div className="mv-auth-card animate-pop-in">
            <div className="mv-auth-card-inner p-6 sm:p-8">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AuthHeader({ title, subtitle, icon }: { title: string; subtitle?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="text-center lg:text-left">
      {icon ? (
        <div className="mv-auth-perk-icon mx-auto mb-4 !h-12 !w-12 lg:mx-0 [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      ) : null}
      <h1 className="font-display text-[26px] font-bold tracking-wide text-white">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[14px] text-mv-muted">{subtitle}</p>}
    </div>
  )
}

export function AuthAlert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : tone === 'success'
        ? 'border-mv-green/30 bg-mv-green/10 text-mv-green'
        : 'border-[var(--color-line-strong)] bg-white/[0.04] text-mv-text'
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
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mv-muted">ou</span>
      <div className="h-px flex-1 bg-[var(--color-line)]" />
    </div>
  )
}

export function DesktopDownloadChip() {
  if (window.electronAPI?.isElectron || isNativeMobileApp()) return null
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-2.5">
      <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="mv-dl">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2.5" y="3.5" width="19" height="13" rx="1.8" fill="currentColor" fillOpacity="0.15" />
          <path d="M8 20.5h8M12 16.5v4M12 6.8v6M9.4 10.4 12 13l2.6-2.6" />
        </svg>
        <span className="text-left">
          <small>Baixar para</small>
          <strong>Windows</strong>
        </span>
      </a>
      <a href={ANDROID_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="mv-dl">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 16.5a7 7 0 0 1 14 0v1.8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" fill="currentColor" fillOpacity="0.15" />
          <path d="M5 16.5a7 7 0 0 1 14 0v1.8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM7.6 7.6 6 5M16.4 7.6 18 5" />
          <path d="M9.2 13.2h.01M14.8 13.2h.01" strokeWidth="2.6" />
        </svg>
        <span className="text-left">
          <small>Baixar para</small>
          <strong>Android</strong>
        </span>
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
  revealable?: boolean
}

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
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-mv-muted" aria-hidden>
          {icon}
        </span>
        <input
          id={inputId}
          type={effectiveType}
          aria-describedby={hintId}
          className={`mv-auth-input h-12 w-full pl-10 ${revealable ? 'pr-11' : 'pr-3'} text-[15px] text-mv-text outline-none`}
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
        <p id={hintId} className="mt-1.5 text-[12px] text-mv-muted">
          {hint}
        </p>
      )}
    </div>
  )
}
