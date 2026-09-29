import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function LegalPageLayout({ title, updatedAt, children }: { title: string; updatedAt: string; children: ReactNode }) {
  return (
    <div className="auth-backdrop relative min-h-full">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <div className="relative mx-auto max-w-3xl px-4 py-8 sm:py-14">
        <Link to="/login" className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          Voltar
        </Link>

        <header className="mt-6 flex items-center gap-4">
          <img src="/logo-192.png" alt="Mamacos Voip" className="h-12 w-12 rounded-2xl object-cover ring-1 ring-[var(--color-line-strong)]" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
            <p className="mt-1 text-[13px] text-discord-text-muted">Última atualização: {updatedAt}</p>
          </div>
        </header>

        <article className="surface-elevated mt-8 space-y-5 rounded-2xl p-6 leading-relaxed text-discord-text sm:p-10 [&_a]:text-discord-blurple [&_a:hover]:underline [&_strong]:text-white">
          {children}
        </article>
      </div>
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-line)] pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-3 font-display text-[17px] font-semibold text-white">{title}</h2>
      <div className="space-y-2 text-[14px] text-discord-text/90">{children}</div>
    </section>
  )
}
